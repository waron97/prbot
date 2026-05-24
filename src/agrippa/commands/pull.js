import inquirer from 'inquirer';
import { dirname } from 'path';
import { readConfig, writeConfig, loadEffectiveEnv } from '../lib/config.js';
import { getPhasesByIds, getPhasesByWorkflow, listMfas } from '../lib/api.js';
import { getToken } from '../../lib/auth.js';
import { computeChecksum } from '../lib/checksum.js';
import { readCodeFile, writeCodeFile, fileExists, toSlug } from '../lib/workspace.js';

async function pull() {
    const config = readConfig();
    loadEffectiveEnv(config);

    const ripUrl = process.env.RIP_URL;
    if (!ripUrl) throw new Error('RIP_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');

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

    // ── pull existing tracked entries ─────────────────────────────────────────
    if (config.workspace.length) {
        console.log('Fetching remote code...');
        const remoteCodeMap = await fetchRemoteCode(token, ripUrl, config.workspace);

        const classified = config.workspace.map((entry) => {
            const key = `${entry.object_type}:${entry.id}`;
            const remoteCode = remoteCodeMap.get(key) ?? null;
            const localCode = readCodeFile(entry.path);

            const remoteChecksum = computeChecksum(remoteCode ?? '');
            const localChecksum = computeChecksum(localCode ?? '');
            const pullChecksum = entry.checksum_at_pull;

            let status;
            if (pullChecksum === localChecksum && pullChecksum === remoteChecksum) {
                status = 'unchanged';
            } else if (pullChecksum === localChecksum) {
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
                    const idx = config.workspace.findIndex(
                        (e) => e.id === entry.id && e.object_type === entry.object_type,
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

    // ── discover new phases on tracked workflows ──────────────────────────────
    await discoverNewPhases(token, ripUrl, config);
}

async function discoverNewPhases(token, ripUrl, config) {
    // Build map of workflow_id → { workflow_name, basePath } from existing phase entries
    const workflows = new Map();
    for (const entry of config.workspace) {
        if (entry.object_type === 'phase' && entry.workflow_id && !workflows.has(entry.workflow_id)) {
            workflows.set(entry.workflow_id, {
                name: entry.workflow_name,
                basePath: dirname(entry.path),
            });
        }
    }

    if (!workflows.size) return;

    const trackedIds = new Set(
        config.workspace.filter((e) => e.object_type === 'phase').map((e) => e.id),
    );

    let newCount = 0;
    for (const [wfId, { name: wfName, basePath }] of workflows) {
        const phases = await getPhasesByWorkflow(token, ripUrl, wfId, { fromCode: true });
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
    // Group by parent folder for folder-level pre-selection
    const folderMap = new Map();
    for (const entry of changed) {
        const folder = dirname(entry.path) || '.';
        if (!folderMap.has(folder)) folderMap.set(folder, []);
        folderMap.get(folder).push(entry);
    }

    const folders = [...folderMap.keys()];

    // Folder-level pre-selection (only shown when there are multiple folders)
    let includedFolders = new Set(folders);
    if (folders.length > 1) {
        const { selectedFolders } = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'selectedFolders',
                message: `Select workflows/folders to ${verb}:`,
                choices: folders.map((f) => ({
                    name: `${f}/  (${folderMap.get(f).length} changed)`,
                    value: f,
                    checked: true,
                })),
            },
        ]);
        includedFolders = new Set(selectedFolders);
    }

    const candidates = changed.filter((e) => includedFolders.has(dirname(e.path) || '.'));

    if (!candidates.length) return [];

    const badgeFor = (status) => {
        if (mode === 'push') {
            return status === 'fast-forward' ? '↑ local updated' : '⚠ remote changes will be overwritten';
        }
        return status === 'fast-forward' ? '↑ remote updated' : '⚠ local changes will be lost';
    };

    const { selected } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'selected',
            message: `Fine-tune records to ${verb}: (space to toggle, a to toggle all)`,
            choices: candidates.map((e) => ({
                name: `[${dirname(e.path) || '.'}]  ${e.name}  [${badgeFor(e.status)}]`,
                value: e,
                checked: true,
            })),
            pageSize: 20,
        },
    ]);

    return selected;
}

export { pull, fetchRemoteCode, selectEntries };
