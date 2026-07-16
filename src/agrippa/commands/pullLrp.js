import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { computeChecksum } from '../lib/checksum.js';
import { fetchUpstream } from '../lib/lrpApi.js';
import { comparePayload, decompose, recompose, stableStringify } from '../lib/pbProject.js';
import { projectReader, writeProject } from '../lib/pbWorkspace.js';

// Delete files under <baseDir>/scripts that are not in the fresh decompose
// map, so a refresh that renames/removes scripts doesn't leave orphans behind
// (LRPs have no pages/ dir — no user tasks).
function pruneOrphans(baseDir, files) {
    const dir = join(baseDir, 'scripts');
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
        if (!(`scripts/${f}` in files)) rmSync(join(dir, f));
    }
}

// Refresh one cloned LRP from upstream (the pull counterpart of
// pushLrpEntry): back up the current local state, re-decompose the upstream
// XML, overwrite local files (pruning orphans), and verify the round-trip.
// `entry.upstream` is the {row, payload} fetched during classification;
// re-resolved by name if absent (id may have changed since the last pull).
async function pullLrpEntry(token, entry, backupDir, backupTs) {
    const upstream = entry.upstream ?? (await fetchUpstream(token, entry.name));
    if (!upstream) throw new Error(`could not fetch upstream LRP "${entry.name}"`);

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
    const { files } = decompose(upstream.payload);
    pruneOrphans(entry.path, files);
    writeProject(entry.path, files);

    // 3. Verify the freshly-written project reconstructs the upstream XML.
    // (pages diff is expected noise for LRPs — see cloneLrp.js.)
    const rebuilt = recompose(projectReader(entry.path));
    const diffs = comparePayload(upstream.payload, rebuilt).filter((d) => !d.startsWith('pages:'));

    return {
        newChecksum: computeChecksum(stableStringify(rebuilt)),
        newRow: upstream.row,
        diffs,
    };
}

export { pullLrpEntry };
