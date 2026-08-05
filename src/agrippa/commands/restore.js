import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import select from '@inquirer/select';
import inquirer from 'inquirer';
import { log, warn } from '../../lib/logger.js';
import { readConfig } from '../lib/config.js';
import { comparePayload, decompose, recompose } from '../lib/pbProject.js';
import { projectReader, writeProject } from '../lib/pbWorkspace.js';
import { writeCodeFile } from '../lib/workspace.js';

const BACKUP_DIR = '.backup';

// Which decomposed subdirectories a restored pb/lrp project should have
// orphans pruned from (LRPs have no pages/ — no user tasks).
const PRUNE_SUBDIRS = {
    process_builder: ['scripts', 'pages'],
    long_running_process: ['scripts'],
};

async function restore(opts = {}) {
    const config = readConfig();

    if (!existsSync(BACKUP_DIR)) {
        log('No .backup/ directory found — nothing to restore.');
        return;
    }

    const timestamps = readdirSync(BACKUP_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();

    if (!timestamps.length) {
        log('No backup snapshots found.');
        return;
    }

    let timestamp = opts.timestamp;
    if (timestamp) {
        if (!timestamps.includes(timestamp)) {
            throw new Error(
                `No such backup snapshot "${timestamp}". Available: ${timestamps.join(', ')}`
            );
        }
    } else {
        const candidates = timestamps.map((ts) => ({
            ts,
            entries: findBackedUpEntries(config.workspace, ts),
        }));
        timestamp = await select({
            message: 'Select a backup snapshot to restore from:',
            choices: candidates.map((c) => ({
                name: `${c.ts}  (${c.entries.length} item${c.entries.length === 1 ? '' : 's'})`,
                value: c.ts,
            })),
        });
    }

    const entries = findBackedUpEntries(config.workspace, timestamp);
    if (!entries.length) {
        log(`No backups for currently tracked resources in ${BACKUP_DIR}/${timestamp}/.`);
        return;
    }

    const choices = entries.map((e) => ({
        name: `${e.name}  [${e.object_type}, ${e.variant} backup]`,
        value: e,
        checked: false,
    }));
    const { selected } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'selected',
            message: `Select records to restore from ${timestamp}:`,
            choices,
            pageSize: 20,
        },
    ]);

    if (!selected.length) {
        log('Nothing selected. No changes made.');
        return;
    }

    for (const entry of selected) {
        if (entry.object_type === 'phase' || entry.object_type === 'mfa') {
            restoreCodeEntry(entry, timestamp);
        } else {
            restoreProjectEntry(entry, timestamp);
        }
        log(`  restored ${entry.name}`);
    }

    log(
        `\nRestored ${selected.length} record(s) from ${BACKUP_DIR}/${timestamp}/ to the local workspace.`
    );
    log('Review with `agrippa diff`, then `agrippa push` when ready.');
}

// Find which tracked workspace entries have backup content inside
// <BACKUP_DIR>/<ts>/, and which variant (push's pre-overwrite remote/upstream
// snapshot, or pull's pre-overwrite local snapshot). An entry can appear twice
// if both a push-backup and a pull-backup exist in the same snapshot.
function findBackedUpEntries(workspace, ts) {
    const found = [];
    for (const entry of workspace) {
        if (entry.object_type === 'phase' || entry.object_type === 'mfa') {
            if (existsSync(join(BACKUP_DIR, ts, entry.path))) {
                found.push({ ...entry, variant: 'push (remote code)' });
            }
        } else if (entry.object_type === 'process_builder') {
            if (existsSync(join(BACKUP_DIR, ts, entry.path, 'upstream.json'))) {
                found.push({ ...entry, variant: 'push (remote payload)', file: 'upstream.json' });
            }
            if (existsSync(join(BACKUP_DIR, ts, entry.path, 'local.json'))) {
                found.push({ ...entry, variant: 'pull (local payload)', file: 'local.json' });
            }
        } else if (entry.object_type === 'long_running_process') {
            if (existsSync(join(BACKUP_DIR, ts, entry.path, 'upstream.xml'))) {
                found.push({ ...entry, variant: 'push (remote BPMN)', file: 'upstream.xml' });
            }
            if (existsSync(join(BACKUP_DIR, ts, entry.path, 'local.json'))) {
                found.push({ ...entry, variant: 'pull (local payload)', file: 'local.json' });
            }
        }
    }
    return found;
}

function restoreCodeEntry(entry, ts) {
    const backupPath = join(BACKUP_DIR, ts, entry.path);
    const content = readFileSync(backupPath, 'utf-8');
    writeCodeFile(entry.path, content);
}

// Restore a process_builder/long_running_process project from its backup file.
// upstream.json/local.json are both a full payload (the same shape decompose()
// already consumes elsewhere); a push-time LRP backup (upstream.xml) only ever
// captured the BPMN text, so it's merged onto the *current* local payload
// first, leaving process.yaml/pages untouched (they were never part of it).
function restoreProjectEntry(entry, ts) {
    const backupFile = join(BACKUP_DIR, ts, entry.path, entry.file);
    let payload;
    if (entry.file === 'upstream.xml') {
        const current = recompose(projectReader(entry.path));
        payload = { ...current, built_page: readFileSync(backupFile, 'utf-8') };
    } else {
        payload = JSON.parse(readFileSync(backupFile, 'utf-8'));
    }

    const { files } = decompose(payload);
    for (const sub of PRUNE_SUBDIRS[entry.object_type]) {
        pruneOrphans(entry.path, sub, files);
    }
    writeProject(entry.path, files);

    const rebuilt = recompose(projectReader(entry.path));
    const diffs = comparePayload(payload, rebuilt);
    if (diffs.length) {
        warn(`  WARNING: ${diffs.length} round-trip diff(s) restoring ${entry.name}`);
    }
}

// Delete files under <baseDir>/<sub> that are not in the restored file map, so
// a restore that removes scripts/pages doesn't leave orphans behind.
function pruneOrphans(baseDir, sub, files) {
    const dir = join(baseDir, sub);
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
        if (!(`${sub}/${f}` in files)) rmSync(join(dir, f));
    }
}

export { restore };
