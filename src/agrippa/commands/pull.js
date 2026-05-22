import inquirer from 'inquirer';
import { dirname } from 'path';
import { readConfig, writeConfig, loadEffectiveEnv } from '../lib/config.js';
import { getPhasesByIds, listMfas } from '../lib/api.js';
import { getToken } from '../../lib/auth.js';
import { computeChecksum } from '../lib/checksum.js';
import { readCodeFile, writeCodeFile, fileExists } from '../lib/workspace.js';

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

    if (!config.workspace.length) {
        console.log('No tracked resources. Run `agrippa clone` first.');
        return;
    }

    console.log('Fetching remote code...');
    const token = await getToken();

    const remoteCodeMap = await fetchRemoteCode(token, ripUrl, config.workspace);

    // Classify each entry
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
            // local untouched since last pull, remote moved ahead
            status = 'fast-forward';
        } else {
            // local was edited; remote may or may not have changed too
            status = 'conflict';
        }

        return { ...entry, remoteCode, status };
    });

    const changed = classified.filter((e) => e.status !== 'unchanged');

    if (!changed.length) {
        console.log('Everything is up to date.');
        return;
    }

    const selected = await selectEntries(changed, 'pull (overwrites local files)');

    if (!selected.length) {
        console.log('Nothing selected. No changes made.');
        return;
    }

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
