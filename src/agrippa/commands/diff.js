import { existsSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { readConfig, loadEffectiveEnv } from '../lib/config.js';
import { fetchRemoteCode } from './pull.js';
import { getToken } from '../../lib/auth.js';
import { readCodeFile, fileExists } from '../lib/workspace.js';
import { computeChecksum } from '../lib/checksum.js';

async function diff(targetArg) {
    const config = readConfig();
    loadEffectiveEnv(config);

    const ripUrl = process.env.RIP_URL;
    if (!ripUrl) throw new Error('RIP_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');

    if (!config.workspace.length) {
        console.log('No tracked resources. Run `agrippa clone` first.');
        return;
    }

    const entries = filterEntries(config.workspace, targetArg);
    if (!entries.length) {
        console.log('No tracked files match the given path.');
        return;
    }

    console.log('Fetching remote code...');
    const token = await getToken();
    const remoteCodeMap = await fetchRemoteCode(token, ripUrl, entries);

    let diffCount = 0;
    const tmpFiles = [];

    try {
        for (const entry of entries) {
            const key = `${entry.object_type}:${entry.id}`;
            const remoteCode = remoteCodeMap.get(key) ?? '';
            const localCode = readCodeFile(entry.path) ?? '';

            if (computeChecksum(localCode) === computeChecksum(remoteCode)) continue;

            if (!fileExists(entry.path)) {
                console.log(`\n--- ${entry.path} (local file missing)`);
                continue;
            }

            // Write remote content to a temp file so git diff --no-index can compare
            const tmpPath = join(tmpdir(), `agrippa-remote-${entry.object_type}-${entry.id}.py`);
            writeFileSync(tmpPath, (remoteCode ?? '').trim() + '\n', 'utf-8');
            tmpFiles.push(tmpPath);

            console.log(`\n=== ${entry.path}  [${entry.name}] ===`);

            const result = spawnSync(
                'git',
                ['diff', '--no-index', '--color=always', tmpPath, entry.path],
                { stdio: ['ignore', 'inherit', 'inherit'] },
            );
            // exit code 1 means differences found (normal), 0 means identical, >1 means error
            if (result.status !== null && result.status > 1) {
                console.error(`git diff failed for ${entry.path}`);
            }
            diffCount++;
        }
    } finally {
        for (const f of tmpFiles) {
            try { unlinkSync(f); } catch { /* ignore */ }
        }
    }

    if (diffCount === 0) {
        console.log('No differences found — all tracked files match the remote.');
    } else {
        console.log(`\n${diffCount} file(s) differ from remote.`);
    }
}

function filterEntries(workspace, targetArg) {
    if (!targetArg) return workspace;

    // Normalise: strip trailing slash
    const target = targetArg.replace(/\/$/, '');

    // If it exists on disk and is a directory, filter by prefix
    if (existsSync(target) && statSync(target).isDirectory()) {
        const prefix = target.endsWith('/') ? target : target + '/';
        return workspace.filter((e) => e.path.startsWith(prefix));
    }

    // Otherwise treat as exact file path (whether it exists yet or not)
    return workspace.filter((e) => e.path === target);
}

export { diff };
