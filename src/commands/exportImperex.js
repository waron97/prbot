import fs from 'fs/promises';
import path from 'path';
import search from '@inquirer/search';
import fetch from 'node-fetch';
import { resolveAddonsPath } from '../lib/addons.js';
import { getToken } from '../lib/auth.js';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { execGit } from '../lib/git.js';
import { log } from '../lib/logger.js';

const IMPEREX_REL = 'sorgenia_imperex_metadata/migrations/0.0.0/imperex';

async function getModels(addonsPath) {
    const dir = path.join(addonsPath, IMPEREX_REL);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listRecords(model, token) {
    const url = `${process.env.RIP_URL}/helpdesk.ticket/prbot_list_records`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ model }),
    });
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
}

async function exportRecord(model, id, token) {
    const url = `${process.env.RIP_URL}/helpdesk.ticket/prbot_imperex_export`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            export_to: 'yaml',
            make_zip: true,
            manifest: {},
            recs: { [model]: [id] },
        }),
    });
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
}

async function exportImperex(opts) {
    const token = await getToken();
    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);

    const models = await getModels(ADDONS_PATH);
    const modelChoices = models.map((m) => ({ name: m, value: m }));
    const model = await search({
        message: 'Select Imperex model:',
        source: async (input) => {
            if (!input) return modelChoices;
            return modelChoices.filter((c) => fuzzyMatch(c.name, input));
        },
    });

    log(`Fetching records for ${model}...`);
    const records = await listRecords(model, token);
    const recChoices = records.map((r) => ({ name: String(r.name ?? r.id), value: r.id }));
    const recordId = await search({
        message: 'Select record to export:',
        source: async (input) => {
            if (!input) return recChoices;
            return recChoices.filter((c) => fuzzyMatch(c.name, input));
        },
    });

    log(`Exporting record ${recordId}...`);
    const { attachments } = await exportRecord(model, recordId, token);

    const modelDir = path.join(ADDONS_PATH, IMPEREX_REL, model);
    await fs.mkdir(modelDir, { recursive: true });

    const saved = [];
    for (const att of attachments) {
        if (att.name === '__manifest__.yaml') continue;
        const destPath = path.join(modelDir, path.basename(att.name));
        await fs.writeFile(destPath, att.content, 'utf-8');
        log(`Written: ${destPath}`);
        saved.push(destPath);
    }

    if (opts.commit !== false) {
        for (const p of saved) {
            await execGit(['add', p], ADDONS_PATH);
        }
        await execGit(
            ['commit', '-m', `[IMP][sorgenia_imperex_metadata] update ${model} record`],
            ADDONS_PATH
        );
        log('Committed.');
    }
}

export { exportImperex };
