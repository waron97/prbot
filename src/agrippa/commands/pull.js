import { dirname } from 'path';
import inquirer from 'inquirer';
import { getToken } from '../../lib/auth.js';
import { log, warn } from '../../lib/logger.js';
import { describeWorkflow, getPhasesByIds, getPhasesByWorkflow, listMfas } from '../lib/api.js';
import { computeChecksum } from '../lib/checksum.js';
import { loadEffectiveEnv, readConfig, writeConfig } from '../lib/config.js';
import { fetchUpstream } from '../lib/lrpApi.js';
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
import { pullLrpEntry } from './pullLrp.js';
import { pullPbEntry } from './pullPb.js';

async function pull(opts = {}) {
    const config = readConfig();
    loadEffectiveEnv(config);

    const ripUrl = process.env.RIP_URL;
    if (!ripUrl)
        throw new Error('RIP_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');

    // Stale-file check
    const stale = config.workspace.filter((e) => !fileExists(e.path));
    if (stale.length) {
        log('\nThe following tracked files no longer exist on disk:');
        stale.forEach((e) => log(`  - ${e.path}  (${e.name})`));
        if (opts.nonInteractive) {
            log('  (non-interactive: leaving them tracked; run interactively to clean up)');
        } else {
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
    }

    const token = await getToken();

    // workflow_ids whose phase code changed this run -> their workflow.yml is
    // refreshed (the graph fetch is skipped for untouched workflows).
    const changedWorkflowIds = new Set();

    // ── pull existing tracked entries ─────────────────────────────────────────
    // process_builder wizards and LRPs are refreshed separately (different
    // checksum/identity model); see pullPbEntries/pullLrpEntries below.
    const pullable = config.workspace.filter(
        (e) => e.object_type !== 'process_builder' && e.object_type !== 'long_running_process'
    );
    if (pullable.length) {
        log('Fetching remote code...');
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
            log('Everything is up to date.');
        } else {
            const selected = await selectEntries(changed, 'pull (overwrites local files)', opts);

            if (!selected.length) {
                log('Nothing selected. No changes made.');
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
                log(`\nPulled ${selected.length} record(s).`);
            }
        }
    } else {
        log('No tracked resources. Run `agrippa clone` first.');
    }

    // ── refresh tracked process-builder wizards ───────────────────────────────
    await pullPbEntries(token, config, opts);

    // ── refresh tracked long-running processes ────────────────────────────────
    await pullLrpEntries(token, config, opts);

    // ── discover new phases on tracked workflows ──────────────────────────────
    await discoverNewPhases(token, ripUrl, config, changedWorkflowIds);
}

// Refresh tracked wizards from upstream. Pull concern (inverted from push):
// overwriting *local* edits. Status per entry:
//   unchanged    local === remote semantically → nothing to do
//   fast-forward remote changed, local untouched since pull → safe overwrite
//   conflict     local diverged from checksum_at_pull → overwrite loses local work
async function pullPbEntries(token, config, opts = {}) {
    const entries = config.workspace.filter((e) => e.object_type === 'process_builder');
    if (!entries.length) return;
    if (!process.env.PB_URL)
        throw new Error('PB_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');

    log('Checking process-builder wizards...');
    const classified = [];
    for (const entry of entries) {
        let upstream = null;
        try {
            upstream = await getProcess(token, entry.guid);
        } catch {
            upstream = null;
        }
        if (!upstream) {
            warn(`  ${entry.name}: could not fetch upstream, skipping`);
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
        log('Wizards are up to date.');
        return;
    }

    const selected = await selectEntries(changed, 'pull (overwrites local wizard files)', opts);
    if (!selected.length) {
        log('No wizards selected.');
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
        log(`  ${entry.name} → refreshed${note}`);
    }
    writeConfig(config);
    log(`\nPulled ${selected.length} wizard(s). Local backups in .backup/${backupTs}/`);
}

// Refresh tracked long-running processes from upstream. Same classification
// concern as pullPbEntries, but entries are located by NAME (the tabulator id
// changes on every save/version — never a stable key).
async function pullLrpEntries(token, config, opts = {}) {
    const entries = config.workspace.filter((e) => e.object_type === 'long_running_process');
    if (!entries.length) return;
    if (!process.env.IMPORTEXPORT_URL)
        throw new Error(
            'IMPORTEXPORT_URL is not configured. Run `prbot init` or set it in agrippa.yaml.'
        );

    log('Checking long-running processes...');
    const classified = [];
    for (const entry of entries) {
        let upstream = null;
        try {
            upstream = await fetchUpstream(token, entry.name);
        } catch {
            upstream = null;
        }
        if (!upstream) {
            warn(`  ${entry.name}: could not fetch upstream, skipping`);
            continue;
        }
        const localSemantic = localChecksum(projectReader(entry.path));
        const remoteSemantic = remoteChecksumPb(upstream.payload);
        const pullChecksum = entry.checksum_at_pull;
        let status;
        if (localSemantic === remoteSemantic) status = 'unchanged';
        else if (pullChecksum === localSemantic) status = 'fast-forward';
        else status = 'conflict';
        classified.push({ ...entry, upstream, status });
    }

    const changed = classified.filter((e) => e.status !== 'unchanged');
    if (!changed.length) {
        log('Long-running processes are up to date.');
        return;
    }

    const selected = await selectEntries(changed, 'pull (overwrites local LRP files)', opts);
    if (!selected.length) {
        log('No long-running processes selected.');
        return;
    }

    const backupTs = new Date().toISOString().replace(/:/g, '-').replace('T', '_').slice(0, 19);
    for (const entry of selected) {
        const res = await pullLrpEntry(token, entry, '.backup', backupTs);
        const idx = config.workspace.findIndex(
            (e) => e.object_type === 'long_running_process' && e.name === entry.name
        );
        if (idx !== -1) {
            config.workspace[idx].checksum_at_pull = res.newChecksum;
            config.workspace[idx].tenant_id = res.newRow.tenantId;
            config.workspace[idx].svg = res.newRow.bpmnFileSvg;
            config.workspace[idx].description = res.newRow.description;
            config.workspace[idx].version = res.newRow.version;
            config.workspace[idx].status = res.newRow.status;
        }
        const note = res.diffs.length ? ` (WARNING: ${res.diffs.length} round-trip diff(s))` : '';
        log(`  ${entry.name} → refreshed${note}`);
    }
    writeConfig(config);
    log(
        `\nPulled ${selected.length} long-running process(es). Local backups in .backup/${backupTs}/`
    );
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
            log(`  new phase: ${filePath}`);
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
                warn(`  could not refresh workflow.yml for ${wfName}: ${err.message}`);
            }
        }
    }

    if (newCount) {
        writeConfig(config);
        log(`Added ${newCount} new phase(s) from tracked workflows.`);
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

// `changed` only ever contains `fast-forward` and `conflict` entries (the
// caller already filtered out `unchanged`). `conflict` means local and remote
// have both diverged from the last-known-good baseline — applying it blindly
// can silently lose either side's work, so it is never preselected and is
// refused outright in `--non-interactive` mode instead of being silently
// skipped or applied.
async function selectEntries(changed, verb, opts = {}) {
    const conflicts = changed.filter((e) => e.status === 'conflict');

    if (opts.nonInteractive) {
        if (conflicts.length) {
            throw new Error(
                `CONFLICT: refusing to ${verb} non-interactively — ${conflicts.length} resource(s) ` +
                    `in conflict: ${conflicts.map((e) => e.name).join(', ')}. Resolve interactively ` +
                    `or re-run once the conflicting side is reconciled.`
            );
        }
        return changed;
    }

    const badgeFor = (status) => (status === 'fast-forward' ? '↑ safe' : '⚠ conflict');

    const choices = changed.map((e) => ({
        name: `${e.name}  [${badgeFor(e.status)}]`,
        value: e,
        checked: e.status !== 'conflict',
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
