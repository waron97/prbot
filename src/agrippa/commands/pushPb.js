import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { updateProcess, createPage, updatePage, publishProcess } from '../lib/pbApi.js';
import { recompose, enumeratePages, stableStringify, localChecksum, MANIFEST_FILE } from '../lib/pbProject.js';
import { projectReader, listPageFiles } from '../lib/pbWorkspace.js';

function stepkeyOf(wrapper) {
    return wrapper?.page?._id?.stepkey ?? wrapper?.name;
}

// Persist a newly-created page's guid into the local manifest so future pushes
// treat it as an existing page (PATCH, not POST).
function recordPageGuid(projectPath, stepkey, file, createdWrapper) {
    const manifestPath = join(projectPath, MANIFEST_FILE);
    const read = projectReader(projectPath);
    const manifest = JSON.parse(read(MANIFEST_FILE));
    manifest.pages = manifest.pages || {};
    const wrapper = { ...createdWrapper };
    delete wrapper.page;
    manifest.pages[stepkey] = { file, wrapper };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

// Push one process_builder entry: backup upstream, sync pages, PATCH the wizard.
// `entry.upstream` is the upstream payload fetched during classification.
// Returns a summary; the wizard is left in "draft".
async function pushPbEntry(token, entry, backupDir, backupTs) {
    const read = projectReader(entry.path);
    const localPayload = recompose(read);
    const upstream = entry.upstream;

    // 1. Backup the full upstream payload before applying edits.
    if (upstream) {
        const backupPath = join(backupDir, backupTs, entry.path, 'upstream.json');
        mkdirSync(dirname(backupPath), { recursive: true });
        writeFileSync(backupPath, JSON.stringify(upstream, null, 2), 'utf-8');
    }

    // 2. Page sync (independent of the wizard save, mirroring the UI page popup).
    const localPages = enumeratePages(read, listPageFiles(entry.path));
    const upstreamByStep = new Map((upstream?.pages || []).map((w) => [stepkeyOf(w), w]));

    let created = 0;
    let updated = 0;
    const pagesForPatch = [];
    for (const lp of localPages) {
        const body = { name: lp.stepkey, page: lp.page };
        if (lp.guid) {
            const up = upstreamByStep.get(lp.stepkey);
            if (!up || stableStringify(up.page) !== stableStringify(lp.page)) {
                await updatePage(token, entry.guid, lp.guid, body);
                updated++;
            }
            pagesForPatch.push({ ...(lp.wrapper || {}), name: lp.stepkey, page: lp.page });
        } else {
            const createdWrapper = (await createPage(token, entry.guid, body)) || {};
            recordPageGuid(entry.path, lp.stepkey, lp.file, createdWrapper);
            pagesForPatch.push({ ...createdWrapper, name: lp.stepkey, page: lp.page });
            created++;
        }
    }
    // Ensure the wizard PATCH body carries every current page (incl. new ones).
    localPayload.pages = pagesForPatch;

    // 3. Save the whole wizard (blocks/structure/scalars). Wizard -> draft.
    const saved = await updateProcess(token, entry.guid, localPayload);

    return {
        created,
        updated,
        newChecksum: localChecksum(read),
        newUpdatedDate: saved?.updated_date,
        newStatus: saved?.status,
    };
}

function publish(token, guid) {
    return publishProcess(token, guid);
}

export { pushPbEntry, publish };
