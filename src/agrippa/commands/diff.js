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
import { error, log } from '../../lib/logger.js';
import { computeChecksum } from '../lib/checksum.js';
import { loadEffectiveEnv, readConfig } from '../lib/config.js';
import { fetchUpstream } from '../lib/lrpApi.js';
import { getProcess } from '../lib/pbApi.js';
import { decompose, localChecksum } from '../lib/pbProject.js';
import { projectReader, writeProject } from '../lib/pbWorkspace.js';
import { fileExists, readCodeFile } from '../lib/workspace.js';
import { fetchRemoteCode } from './pull.js';

async function diff(targetArg) {
    const config = readConfig();
    loadEffectiveEnv(config);

    if (!config.workspace.length) {
        log('No tracked resources. Run `agrippa clone` first.');
        return;
    }

    const entries = filterEntries(config.workspace, targetArg);
    if (!entries.length) {
        log('No tracked files match the given path.');
        return;
    }

    // Decomposed projects (pb + lrp) diff as whole directory trees; phases and
    // MFAs are single code files. An LRP left in the code bucket used to reach
    // readCodeFile() with a directory path and blow up with EISDIR, so the
    // split is by "is this a project" rather than "is this a wizard".
    const projectEntries = entries.filter((e) => PROJECT_TYPES.has(e.object_type));
    const codeEntries = entries.filter((e) => !PROJECT_TYPES.has(e.object_type));

    if (codeEntries.length && !process.env.RIP_URL)
        throw new Error('RIP_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');
    if (projectEntries.some((e) => e.object_type === 'process_builder') && !process.env.PB_URL)
        throw new Error('PB_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');
    if (
        projectEntries.some((e) => e.object_type === 'long_running_process') &&
        !process.env.IMPORTEXPORT_URL
    )
        throw new Error(
            'IMPORTEXPORT_URL is not configured. Run `prbot init` or set it in agrippa.yaml.'
        );

    log('Fetching remote code...');
    const token = await getToken();

    let diffCount = 0;
    const chunks = [];

    if (codeEntries.length) {
        const remoteCodeMap = await fetchRemoteCode(token, process.env.RIP_URL, codeEntries);
        const { diffCount: c, chunks: cs } = diffCodeEntries(codeEntries, remoteCodeMap);
        diffCount += c;
        chunks.push(...cs);
    }

    for (const entry of projectEntries) {
        const { hasDiff, chunk } = await diffProjectEntry(token, entry);
        if (hasDiff) {
            diffCount++;
            chunks.push(chunk);
        }
    }

    if (diffCount === 0) {
        log('No differences found — all tracked files match the remote.');
    } else {
        const combined = Buffer.concat(chunks);
        const pager = process.env.PAGER || 'less';
        const pagerArgs = pager === 'less' ? ['-R', '-F'] : [];
        spawnSync(pager, pagerArgs, { input: combined, stdio: ['pipe', 'inherit', 'inherit'] });
        log(`\n${diffCount} file(s) differ from remote.`);
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
                log(`\n--- ${entry.path} (local file missing)`);
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
                error(`git diff failed for ${entry.path}`);
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

// Decomposed project (process-builder wizard or long-running process): fetch
// the upstream payload, decompose it into a throwaway project tree (exactly
// what re-cloning now would produce) and diff it against a copy of the local
// project, recursively. `.backup/` and `preview.svg` are local-only artifacts
// (push backups, dev preview render) with no upstream counterpart, so they're
// stripped from the local copy before diffing.
//
// The two types differ only in how upstream is reached: a wizard by guid, an
// LRP by name (its tabulator id changes on every save — never a stable key,
// see pullLrpEntry). Everything downstream is the shared decompose pipeline.
const PROJECT_TYPES = new Set(['process_builder', 'long_running_process']);

async function fetchProjectUpstream(token, entry) {
    if (entry.object_type === 'long_running_process') {
        const res = await fetchUpstream(token, entry.name);
        if (!res?.payload) throw new Error(`could not fetch upstream LRP "${entry.name}"`);
        return res.payload;
    }
    const upstream = await getProcess(token, entry.guid);
    if (!upstream) throw new Error(`could not fetch upstream wizard ${entry.guid}`);
    return upstream;
}

async function diffProjectEntry(token, entry) {
    const upstream = await fetchProjectUpstream(token, entry);
    const label =
        entry.object_type === 'long_running_process' ? 'long-running process' : 'process-builder';

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
            error(`git diff failed for ${entry.path}`);
        }
        const header = Buffer.from(`\n=== ${entry.path}  [${entry.name}] (${label}) ===\n`);
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

    // If it exists on disk and is a directory, take both the entries *under* it
    // (a workflow folder holding one file per phase) and any entry that *is* it
    // — a pb/lrp project is tracked as the directory itself, so prefix matching
    // alone silently returned nothing for the most common target.
    if (existsSync(target) && statSync(target).isDirectory()) {
        const prefix = target + '/';
        const matches = workspace.filter((e) => e.path === target || e.path.startsWith(prefix));
        if (matches.length) return matches;
    }

    // Exact file path (whether it exists yet or not), else fall back to the
    // identifiers the other commands accept — document_id (`--pb`) and name.
    const byPath = workspace.filter((e) => e.path === target);
    if (byPath.length) return byPath;
    return workspace.filter((e) => e.document_id === target || e.name === target);
}

export { diff };
