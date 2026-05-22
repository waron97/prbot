import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import inquirer from 'inquirer';
import { readConfig, writeConfig, loadEffectiveEnv } from '../lib/config.js';
import { updatePhase, updateMfa } from '../lib/api.js';
import { getToken } from '../../lib/auth.js';
import { computeChecksum } from '../lib/checksum.js';
import { readCodeFile, fileExists } from '../lib/workspace.js';
import { fetchRemoteCode, selectEntries } from './pull.js';

const BACKUP_DIR = '.backup';

async function push() {
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

    // Classify — concern here is remote work being overwritten
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
        } else if (pullChecksum === remoteChecksum) {
            // remote untouched since last pull, local has new changes
            status = 'fast-forward';
        } else {
            // remote changed since last pull — pushing will overwrite remote work
            status = 'conflict';
        }

        return { ...entry, remoteCode, localCode, status };
    });

    const changed = classified.filter((e) => e.status !== 'unchanged');

    if (!changed.length) {
        console.log('Nothing to push — local files match the last-pulled state.');
        return;
    }

    const selected = await selectEntries(changed, 'push (overwrites remote code)', 'push');

    if (!selected.length) {
        console.log('Nothing selected. No changes made.');
        return;
    }

    // Write backups of remote code before overwriting
    const backupTs = new Date()
        .toISOString()
        .replace(/:/g, '-')
        .replace('T', '_')
        .slice(0, 19);

    for (const entry of selected) {
        if (entry.remoteCode !== null) {
            const backupPath = join(BACKUP_DIR, backupTs, entry.path);
            mkdirSync(dirname(backupPath), { recursive: true });
            writeFileSync(backupPath, (entry.remoteCode ?? '').trim() + '\n', 'utf-8');
        }
    }
    console.log(`Remote backups written to ${BACKUP_DIR}/${backupTs}/`);

    // Push local code to API
    let pushed = 0;
    for (const entry of selected) {
        const code = entry.localCode ?? '';
        if (entry.object_type === 'phase') {
            await updatePhase(token, ripUrl, entry.id, code);
        } else {
            await updateMfa(token, ripUrl, entry.id, code);
        }

        const idx = config.workspace.findIndex(
            (e) => e.id === entry.id && e.object_type === entry.object_type,
        );
        if (idx !== -1) {
            config.workspace[idx].checksum_at_pull = computeChecksum(code);
        }
        pushed++;
    }

    writeConfig(config);
    console.log(`\nPushed ${pushed} record(s).`);
}

export { push };
