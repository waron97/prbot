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
// The save bumps the version and mints a NEW id, so the pre-save id is stale
// the moment saveLrp returns. Both the deploy target and the post-save
// version/status must come from a fresh resolve-by-name AFTER the save — never
// from the pre-save row or the PATCH response (which does not echo the new id).
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

    // The save minted a new id and bumped the version — re-resolve by name to
    // get the fresh row. deployBpmn must target this new id (the pre-save id is
    // now dead: deploying it 200s but activates nothing), and the workspace
    // entry's version/status must come from here, not the stale pre-save row.
    const deployRow = await resolveLrpByName(token, entry.name);

    return {
        newChecksum: localChecksum(read),
        newRow: { ...deployRow, description },
        saved,
        deployId: deployRow.id,
    };
}

function deploy(token, id) {
    return deployLrp(token, id);
}

export { pushLrpEntry, deploy };
