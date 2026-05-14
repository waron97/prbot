import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import search from '@inquirer/search';
import { getToken } from '../lib/auth.js';
import { execGit } from '../lib/git.js';
import { resolveAddonsPath } from '../lib/addons.js';
import { fuzzyMatch } from '../lib/fuzzy.js';

async function getProcessList(token) {
    const url = `${process.env.IMPORTEXPORT_URL}/object/process_builder?addLanguageParam=true`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ page: 1, size: 999999, filters: [] }),
    });
    if (!response.ok) throw new Error(await response.text());
    const json = await response.json();
    return json.data;
}

async function initiateExport(guid, token) {
    const url = `${process.env.IMPORTEXPORT_URL}/symphony/export`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify([{ object_guid: guid, object_type: 'process_builder' }]),
    });
    if (!response.ok) throw new Error(await response.text());
}

async function pollExportResult(guid, requestTime, token) {
    const url = `${process.env.IMPORTEXPORT_URL}/export/info/processKey=ExportElement&subProcess=true&status=FAILED,COMPLETED&referenceId=process_builder`;
    // Server createDate is offset -1hr from system time; subtract 1hr+5s buffer
    const cutoff = requestTime - 3_605_000;

    while (true) {
        await new Promise((r) => setTimeout(r, 3000));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ page: 1, size: 7, sorters: [] }),
        });
        if (!response.ok) throw new Error(await response.text());

        const { data } = await response.json();
        const match = data.find(
            (item) =>
                item.customResponse?.guid === guid &&
                new Date(item.createdDate).getTime() >= cutoff
        );

        if (!match) continue;
        if (match.status === 'FAILED') throw new Error(`Export failed for guid ${guid}`);
        return match.requestId;
    }
}

async function downloadZip(requestId, token) {
    const url = `${process.env.IMPORTEXPORT_URL}/export/${requestId}`;
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
    });
    if (!response.ok) throw new Error(await response.text());
    return Buffer.from(await response.arrayBuffer());
}

async function findExistingZip(baseDir, filename) {
    async function walk(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return null;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = await walk(full);
                if (found) return found;
            } else if (entry.name === filename) {
                return full;
            }
        }
        return null;
    }
    return walk(baseDir);
}

async function exportPb(opts) {
    const token = await getToken();

    const processes = await getProcessList(token);
    const choices = processes.map((p) => ({
        name: `${p.process_name} (${p.document_id})`,
        value: { guid: p.guid, document_id: p.document_id },
    }));

    const selected = await search({
        message: 'Select PB process to export:',
        source: async (input) => {
            if (!input) return choices;
            return choices.filter((c) => fuzzyMatch(c.name, input));
        },
    });

    const { guid, document_id } = selected;
    const filename = `${document_id}.zip`;

    console.log(`Initiating export for ${document_id}...`);
    const requestTime = Date.now();
    await initiateExport(guid, token);

    console.log('Waiting for export to complete...');
    const requestId = await pollExportResult(guid, requestTime, token);

    console.log(`Downloading ${filename}...`);
    const zipBuffer = await downloadZip(requestId, token);

    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const processesDir = path.join(ADDONS_PATH, '.cloudbuild', 'pb', 'B2WA', 'processes');

    const existing = await findExistingZip(processesDir, filename);
    let savePath;
    if (existing) {
        savePath = existing;
        await fs.writeFile(savePath, zipBuffer);
        console.log(`Updated existing file at ${savePath}`);
    } else {
        savePath = path.join(processesDir, 'all', filename);
        await fs.mkdir(path.dirname(savePath), { recursive: true });
        await fs.writeFile(savePath, zipBuffer);
        console.log(`Created new file at ${savePath}`);
    }

    if (opts.commit !== false) {
        await execGit(['add', savePath], ADDONS_PATH);
        await execGit(['commit', '-m', '[IMP][.cloudbuild] Update wizard'], ADDONS_PATH);
        console.log('Committed.');
    }
}

export { exportPb };
