import { dirname } from 'path';
import inquirer from 'inquirer';
import { getToken } from '../../lib/auth.js';
import { describeWorkflow, getPhasesByIds, getPhasesByWorkflow, listMfas } from '../lib/api.js';
import { computeChecksum } from '../lib/checksum.js';
import { loadEffectiveEnv, readConfig, writeConfig } from '../lib/config.js';
import { getProcess } from '../lib/pbApi.js';
import { localChecksum, remoteChecksumPb } from '../lib/pbProject.js';
import { projectReader } from '../lib/pbWorkspace.js';
import {
    fileExists,
    readCodeFile,
    toSlug,
    writeCodeFile,
    writeWorkflowDoc,
} from '../lib/workspace.js';
import { pullPbEntry } from './pullPb.js';

async function pull() {
    const config = readConfig();
    loadEffectiveEnv(config);

    const ripUrl = process.env.RIP_URL;
    if (!ripUrl)
        throw new Error('RIP_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');

    // Stale-file check
    const stale = config.workspace.filter((e) => !fileExists(e.path));
    if (stale.length) {
        console.log('\nThe following tracked files no longer exist on disk:');
        stale.forEach((e) => console.log(`  - ${e.path}  (${e.name})`));
        const { cleanup } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'cleanup',
                message: 'Remove these entries from the workspace config?',
                default: true,
            },
        ]);
        if (cleanup) {
            config.workspace = config.workspace.filter((e) => fileExists(e.path));
            writeConfig(config);
        }
    }

    const token = await getToken();

    // workflow_ids whose phase code changed this run -> their workflow.yml is
    // refreshed (the graph fetch is skipped for untouched workflows).
    const changedWorkflowIds = new Set();

    // ── pull existing tracked entries ─────────────────────────────────────────
    // process_builder wizards are refreshed separately (different checksum model);
    // see pullPbEntries below.
    const pullable = config.workspace.filter((e) => e.object_type !== 'process_builder');
    if (pullable.length) {
        console.log('Fetching remote code...');
        const remoteCodeMap = await fetchRemoteCode(token, ripUrl, pullable);

        const classified = pullable.map((entry) => {
            const key = `${entry.object_type}:${entry.id}`;
            const remoteCode = remoteCodeMap.get(key) ?? null;
            const localCode = readCodeFile(entry.path);

            const remoteChecksum = computeChecksum(remoteCode ?? '');
            const localChecksumVal = computeChecksum(localCode ?? '');
            const pullChecksum = entry.checksum_at_pull;

            let status;
            if (localChecksumVal === remoteChecksum) {
                status = 'unchanged';
            } else if (pullChecksum === localChecksumVal) {
                status = 'fast-forward';
            } else {
                status = 'conflict';
            }

            return { ...entry, remoteCode, status };
        });

        const changed = classified.filter((e) => e.status !== 'unchanged');

        if (!changed.length) {
            console.log('Everything is up to date.');
        } else {
            const selected = await selectEntries(changed, 'pull (overwrites local files)');

            if (!selected.length) {
                console.log('Nothing selected. No changes made.');
            } else {
                for (const entry of selected) {
                    writeCodeFile(entry.path, entry.remoteCode);
                    if (entry.object_type === 'phase' && entry.workflow_id) {
                        changedWorkflowIds.add(entry.workflow_id);
                    }
                    const idx = config.workspace.findIndex(
                        (e) => e.id === entry.id && e.object_type === entry.object_type
                    );
                    if (idx !== -1) {
                        config.workspace[idx].checksum_at_pull = computeChecksum(entry.remoteCode);
                    }
                }
                writeConfig(config);
                console.log(`\nPulled ${selected.length} record(s).`);
            }
        }
    } else {
        console.log('No tracked resources. Run `agrippa clone` first.');
    }

    // ── refresh tracked process-builder wizards ───────────────────────────────
    await pullPbEntries(token, config);

    // ── discover new phases on tracked workflows ──────────────────────────────
    await discoverNewPhases(token, ripUrl, config, changedWorkflowIds);
}

// Refresh tracked wizards from upstream. Pull concern (inverted from push):
// overwriting *local* edits. Status per entry:
//   unchanged    local === remote semantically → nothing to do
//   fast-forward remote changed, local untouched since pull → safe overwrite
//   conflict     local diverged from checksum_at_pull → overwrite loses local work
async function pullPbEntries(token, config) {
    const entries = config.workspace.filter((e) => e.object_type === 'process_builder');
    if (!entries.length) return;
    if (!process.env.PB_URL)
        throw new Error('PB_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');

    console.log('Checking process-builder wizards...');
    const classified = [];
    for (const entry of entries) {
        let upstream = null;
        try {
            upstream = await getProcess(token, entry.guid);
        } catch {
            upstream = null;
        }
        if (!upstream) {
            console.warn(`  ${entry.name}: could not fetch upstream, skipping`);
            continue;
        }
        const localSemantic = localChecksum(projectReader(entry.path));
        const remoteSemantic = remoteChecksumPb(upstream);
        const pullChecksum = entry.checksum_at_pull;
        let status;
        if (localSemantic === remoteSemantic) status = 'unchanged';
        else if (pullChecksum === localSemantic) status = 'fast-forward';
        else status = 'conflict';
        classified.push({ ...entry, upstream, status });
    }

    const changed = classified.filter((e) => e.status !== 'unchanged');
    if (!changed.length) {
        console.log('Wizards are up to date.');
        return;
    }

    const selected = await selectEntries(changed, 'pull (overwrites local wizard files)');
    if (!selected.length) {
        console.log('No wizards selected.');
        return;
    }

    const backupTs = new Date().toISOString().replace(/:/g, '-').replace('T', '_').slice(0, 19);
    for (const entry of selected) {
        const res = await pullPbEntry(token, entry, '.backup', backupTs);
        const idx = config.workspace.findIndex(
            (e) => e.object_type === 'process_builder' && e.guid === entry.guid
        );
        if (idx !== -1) {
            config.workspace[idx].checksum_at_pull = res.newChecksum;
            if (res.newUpdatedDate) config.workspace[idx].updated_date = res.newUpdatedDate;
            if (res.newStatus) config.workspace[idx].status = res.newStatus;
        }
        const note = res.diffs.length ? ` (WARNING: ${res.diffs.length} round-trip diff(s))` : '';
        console.log(`  ${entry.name} → refreshed${note}`);
    }
    writeConfig(config);
    console.log(`\nPulled ${selected.length} wizard(s). Local backups in .backup/${backupTs}/`);
}

async function discoverNewPhases(token, ripUrl, config, changedWorkflowIds = new Set()) {
    // Build map of workflow_id → { workflow_name, basePath } from existing phase entries
    const workflows = new Map();
    for (const entry of config.workspace) {
        if (
            entry.object_type === 'phase' &&
            entry.workflow_id &&
            !workflows.has(entry.workflow_id)
        ) {
            workflows.set(entry.workflow_id, {
                name: entry.workflow_name,
                basePath: dirname(entry.path),
            });
        }
    }

    if (!workflows.size) return;

    const trackedIds = new Set(
        config.workspace.filter((e) => e.object_type === 'phase').map((e) => e.id)
    );

    let newCount = 0;
    for (const [wfId, { name: wfName, basePath }] of workflows) {
        const phases = await getPhasesByWorkflow(token, ripUrl, wfId, { fromCode: true });
        let wfChanged = changedWorkflowIds.has(wfId);
        for (const phase of phases) {
            if (trackedIds.has(phase.id)) continue;
            const filePath = `${basePath}/${toSlug(phase.name)}.py`;
            writeCodeFile(filePath, phase.code);
            config.workspace.push({
                path: filePath,
                id: phase.id,
                object_type: 'phase',
                workflow_id: wfId,
                workflow_name: wfName,
                checksum_at_pull: computeChecksum(phase.code),
                name: `${wfName} / ${phase.name}`,
            });
            console.log(`  new phase: ${filePath}`);
            newCount++;
            wfChanged = true;
        }

        // Refresh the read-only workflow graph only when this workflow's code
        // changed this run, or when its doc is missing (one-time backfill).
        // Skips the per-workflow graph fetch for untouched workflows.
        if (wfChanged || !fileExists(`${basePath}/workflow.yml`)) {
            try {
                const structure = await describeWorkflow(token, ripUrl, wfId);
                writeWorkflowDoc(basePath, structure);
            } catch (err) {
                console.warn(`  could not refresh workflow.yml for ${wfName}: ${err.message}`);
            }
        }
    }

    if (newCount) {
        writeConfig(config);
        console.log(`Added ${newCount} new phase(s) from tracked workflows.`);
    }
}

// ── shared helpers ────────────────────────────────────────────────────────────

async function fetchRemoteCode(token, ripUrl, workspace) {
    const map = new Map();

    const phaseEntries = workspace.filter((e) => e.object_type === 'phase');
    const mfaEntries = workspace.filter((e) => e.object_type === 'mfa');

    if (phaseEntries.length) {
        const ids = phaseEntries.map((e) => e.id);
        const phases = await getPhasesByIds(token, ripUrl, ids);
        phases.forEach((p) => map.set(`phase:${p.id}`, p.code));
    }

    if (mfaEntries.length) {
        const allMfas = await listMfas(token, ripUrl);
        mfaEntries.forEach((e) => {
            const remote = allMfas.find((m) => m.id === e.id);
            if (remote) map.set(`mfa:${e.id}`, remote.code);
        });
    }

    return map;
}

async function selectEntries(changed, verb, mode = 'pull') {
    const badgeFor = (status) => {
        if (mode === 'push') {
            return status === 'fast-forward' ? '↑ safe' : '⚠ conflict';
        }
        return status === 'fast-forward' ? '↑ safe' : '⚠ conflict';
    };

    const choices = changed.map((e) => ({
        name: `${e.name}  [${badgeFor(e.status)}]`,
        value: e,
        checked: true,
    }));

    const { selected } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'selected',
            message: `Select records to ${verb}:`,
            choices,
            pageSize: 20,
        },
    ]);

    return selected;
}

export { pull, fetchRemoteCode, selectEntries };
