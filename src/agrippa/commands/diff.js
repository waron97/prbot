import { spawnSync } from 'child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getToken } from '../../lib/auth.js';
import { computeChecksum } from '../lib/checksum.js';
import { loadEffectiveEnv, readConfig } from '../lib/config.js';
import { getProcess } from '../lib/pbApi.js';
import { decompose, localChecksum } from '../lib/pbProject.js';
import { projectReader, writeProject } from '../lib/pbWorkspace.js';
import { fileExists, readCodeFile } from '../lib/workspace.js';
import { fetchRemoteCode } from './pull.js';

async function diff(targetArg) {
    const config = readConfig();
    loadEffectiveEnv(config);

    if (!config.workspace.length) {
        console.log('No tracked resources. Run `agrippa clone` first.');
        return;
    }

    const entries = filterEntries(config.workspace, targetArg);
    if (!entries.length) {
        console.log('No tracked files match the given path.');
        return;
    }

    const pbEntries = entries.filter((e) => e.object_type === 'process_builder');
    const codeEntries = entries.filter((e) => e.object_type !== 'process_builder');

    if (codeEntries.length && !process.env.RIP_URL)
        throw new Error('RIP_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');
    if (pbEntries.length && !process.env.PB_URL)
        throw new Error('PB_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');

    console.log('Fetching remote code...');
    const token = await getToken();

    let diffCount = 0;
    const chunks = [];

    if (codeEntries.length) {
        const remoteCodeMap = await fetchRemoteCode(token, process.env.RIP_URL, codeEntries);
        const { diffCount: c, chunks: cs } = diffCodeEntries(codeEntries, remoteCodeMap);
        diffCount += c;
        chunks.push(...cs);
    }

    for (const entry of pbEntries) {
        const { hasDiff, chunk } = await diffPbEntry(token, entry);
        if (hasDiff) {
            diffCount++;
            chunks.push(chunk);
        }
    }

    if (diffCount === 0) {
        console.log('No differences found — all tracked files match the remote.');
    } else {
        const combined = Buffer.concat(chunks);
        const pager = process.env.PAGER || 'less';
        const pagerArgs = pager === 'less' ? ['-R', '-F'] : [];
        spawnSync(pager, pagerArgs, { input: combined, stdio: ['pipe', 'inherit', 'inherit'] });
        console.log(`\n${diffCount} file(s) differ from remote.`);
    }
}

// Single-file phase/mfa code entries: write the remote body to a tmp file and
// hand both sides to `git diff --no-index`.
function diffCodeEntries(entries, remoteCodeMap) {
    let diffCount = 0;
    const chunks = [];
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

            const tmpPath = join(tmpdir(), `agrippa-remote-${entry.object_type}-${entry.id}.py`);
            writeFileSync(tmpPath, (remoteCode ?? '').trim() + '\n', 'utf-8');
            tmpFiles.push(tmpPath);

            const result = spawnSync(
                'git',
                ['diff', '--no-index', '--color=always', tmpPath, entry.path],
                { stdio: ['ignore', 'pipe', 'pipe'] }
            );
            // exit code 1 means differences found (normal), 0 means identical, >1 means error
            if (result.status !== null && result.status > 1) {
                console.error(`git diff failed for ${entry.path}`);
            }
            const header = Buffer.from(`\n=== ${entry.path}  [${entry.name}] ===\n`);
            chunks.push(Buffer.concat([header, result.stdout ?? Buffer.alloc(0)]));
            diffCount++;
        }
    } finally {
        for (const f of tmpFiles) {
            try {
                unlinkSync(f);
            } catch {
                /* ignore */
            }
        }
    }
    return { diffCount, chunks };
}

// Process-builder wizard: decompose the upstream payload into a throwaway
// project tree (exactly what re-cloning now would produce) and diff it against
// a copy of the local project, recursively. `.backup/` and `preview.svg` are
// local-only artifacts (push backups, dev preview render) with no upstream
// counterpart, so they're stripped from the local copy before diffing.
async function diffPbEntry(token, entry) {
    const upstream = await getProcess(token, entry.guid);
    if (!upstream) throw new Error(`could not fetch upstream wizard ${entry.guid}`);

    const tmpRoot = mkdtempSync(join(tmpdir(), 'agrippa-pb-diff-'));
    try {
        const upstreamDir = join(tmpRoot, 'upstream');
        const localDir = join(tmpRoot, 'local');
        mkdirSync(upstreamDir, { recursive: true });
        writeProject(upstreamDir, decompose(upstream).files);

        cpSync(entry.path, localDir, { recursive: true });
        rmSync(join(localDir, '.backup'), { recursive: true, force: true });
        rmSync(join(localDir, 'preview.svg'), { force: true });

        // Compare via the recompose pipeline on both sides (not raw upstream JSON
        // vs. local): the BPMN xml is regenerated from structure.yaml on rebuild
        // and never matches the raw upstream xml byte-for-byte even when nothing
        // structural changed, so it'd otherwise look like a permanent false diff.
        if (localChecksum(projectReader(upstreamDir)) === localChecksum(projectReader(localDir)))
            return { hasDiff: false };

        const result = spawnSync(
            'git',
            ['diff', '--no-index', '--color=always', 'upstream', 'local'],
            { cwd: tmpRoot, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        if (result.status !== null && result.status > 1) {
            console.error(`git diff failed for ${entry.path}`);
        }
        const header = Buffer.from(`\n=== ${entry.path}  [${entry.name}] (process-builder) ===\n`);
        const chunk = Buffer.concat([header, result.stdout ?? Buffer.alloc(0)]);
        return { hasDiff: true, chunk };
    } finally {
        rmSync(tmpRoot, { recursive: true, force: true });
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
