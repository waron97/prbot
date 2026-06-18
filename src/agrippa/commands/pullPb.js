import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { computeChecksum } from '../lib/checksum.js';
import { getProcess } from '../lib/pbApi.js';
import { comparePayload, decompose, recompose, stableStringify } from '../lib/pbProject.js';
import { projectReader, writeProject } from '../lib/pbWorkspace.js';

// Delete files under <baseDir>/<sub> that are not in the fresh decompose map, so
// a refresh that renames/removes scripts or pages doesn't leave orphans behind.
function pruneOrphans(baseDir, sub, files) {
    const dir = join(baseDir, sub);
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
        if (!(`${sub}/${f}` in files)) rmSync(join(dir, f));
    }
}

// Refresh one cloned wizard from upstream (the pull counterpart of pushPbEntry):
// back up the current local state, re-decompose the upstream payload, overwrite
// local files (pruning orphans), and verify the round-trip. `entry.upstream` is
// the payload fetched during classification; refetched if absent.
async function pullPbEntry(token, entry, backupDir, backupTs) {
    const upstream = entry.upstream ?? (await getProcess(token, entry.guid));
    if (!upstream) throw new Error(`could not fetch upstream wizard ${entry.guid}`);

    // 1. Backup the current local state (recomposed payload) before overwriting.
    try {
        const localPayload = recompose(projectReader(entry.path));
        const backupPath = join(backupDir, backupTs, entry.path, 'local.json');
        mkdirSync(dirname(backupPath), { recursive: true });
        writeFileSync(backupPath, JSON.stringify(localPayload, null, 2), 'utf-8');
    } catch {
        // local files unreadable (e.g. mid-edit) — nothing safe to back up, proceed.
    }

    // 2. Decompose upstream → fresh file map; prune orphans; write.
    const { files } = decompose(upstream);
    pruneOrphans(entry.path, 'scripts', files);
    pruneOrphans(entry.path, 'pages', files);
    writeProject(entry.path, files);

    // 3. Verify the freshly-written project reconstructs the upstream payload.
    const rebuilt = recompose(projectReader(entry.path));
    const diffs = comparePayload(upstream, rebuilt);

    return {
        newChecksum: computeChecksum(stableStringify(rebuilt)),
        newUpdatedDate: upstream.updated_date,
        newStatus: upstream.status,
        diffs,
    };
}

export { pullPbEntry };
