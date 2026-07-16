import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { deployLrp, resolveLrpByName, saveLrp } from '../lib/lrpApi.js';
import { localChecksum, recompose } from '../lib/pbProject.js';
import { projectReader } from '../lib/pbWorkspace.js';

// Push one LRP entry: back up upstream, re-resolve the CURRENT id/tenantId by
// name (never trust a stored/stale id — it changes on every save/version),
// and PATCH the recomposed XML back. Returns a summary; deploy is a separate
// step (see deploy()), mirroring PB's push-then-publish split.
//
// `saved` (the PATCH response) is returned to the caller un-interpreted: it
// isn't yet verified live whether it echoes a fresh id/version or whether
// deploy always wants the pre-save row id — confirm against a real save
// before wiring `deploy` to fire automatically.
async function pushLrpEntry(token, entry, backupDir, backupTs) {
    const read = projectReader(entry.path);
    const localPayload = recompose(read);
    const upstream = entry.upstream; // { row, payload } from push.js's classification

    if (upstream) {
        const backupPath = join(backupDir, backupTs, entry.path, 'upstream.xml');
        mkdirSync(dirname(backupPath), { recursive: true });
        writeFileSync(backupPath, upstream.payload.built_page, 'utf-8');
    }

    // Re-resolve immediately before saving — the row captured during
    // classification may be stale if something else saved in between.
    const row = await resolveLrpByName(token, entry.name);
    const description = upstream?.row?.description ?? entry.description ?? '';
    const saved = await saveLrp(
        token,
        { ...row, bpmnFileSvg: entry.svg ?? row.bpmnFileSvg },
        localPayload.built_page,
        description
    );

    return {
        newChecksum: localChecksum(read),
        newRow: { ...row, description },
        saved,
    };
}

function deploy(token, id) {
    return deployLrp(token, id);
}

export { pushLrpEntry, deploy };
