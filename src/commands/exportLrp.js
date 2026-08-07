import fs from 'fs/promises';
import path from 'path';
import search from '@inquirer/search';
import fetch from 'node-fetch';
import { resolveAddonsPath } from '../lib/addons.js';
import { getToken } from '../lib/auth.js';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { execGit } from '../lib/git.js';
import { emitJson, isJsonMode, log } from '../lib/logger.js';
import { requireInteractive } from '../lib/tty.js';

function getSymphonyBase() {
    const url = process.env.IMPORTEXPORT_URL;
    if (!url) throw new Error('IMPORTEXPORT_URL not configured');
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
}

async function fetchProcesses(token, nameFilter, signal) {
    const base = getSymphonyBase();
    const size = nameFilter ? 20 : 12;
    const params = encodeURIComponent(JSON.stringify({ page: 1, size, sorters: [], filters: [] }));
    const otherfilters = encodeURIComponent(
        JSON.stringify([
            { field: 'id', type: '=', value: null },
            { field: 'name', type: 'like', value: nameFilter ?? null },
            { field: 'tenantId', type: '=', value: null },
            { field: 'latestVersion', type: '=', value: true },
        ])
    );
    const othersort = encodeURIComponent(
        JSON.stringify({ field: 'lastModifiedDate', dir: 'desc' })
    );
    const url = `${base}/symphony/restInfo/ajax/tabulator?params=${params}&connector=SymphBpmnFileTabCon&otherfilters=${otherfilters}&card=true&othersort=${othersort}`;

    const response = await fetch(url, {
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${token}`,
        },
        signal,
    });
    if (!response.ok) throw new Error(await response.text());
    const json = await response.json();

    const items = [];
    for (const row of json.data || []) {
        for (let i = 1; i <= 4; i++) {
            const cell = row[`cellContent${i}`];
            if (cell && cell.id && cell.name) {
                items.push({ id: String(cell.id), name: cell.name });
            }
        }
    }
    return items;
}

async function fetchProcessDetail(id, token) {
    const base = getSymphonyBase();
    const url = `${base}/symphony/restInfo/ajax/tabulator/id/${id}?connector=SymphBpmnFileTabCon&modelroot=/management/development/edit`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await response.text());
    return response.text();
}

function extractBpmnData(jsText) {
    const valueMatch = jsText.match(/doc\.value\s*=\s*'([^']+)'/);
    if (!valueMatch) throw new Error('Could not find doc.value in response');

    const filenameMatch = jsText.match(/filename\.value\s*=\s*'([^']+)'/);
    if (!filenameMatch) throw new Error('Could not find filename.value in response');

    const xml = Buffer.from(valueMatch[1], 'base64').toString('utf-8');
    const filename = filenameMatch[1];
    return { xml, filename };
}

async function findExistingFile(baseDir, filename) {
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

async function exportLrp(opts) {
    const token = await getToken();

    log('Fetching processes...');
    const initialItems = await fetchProcesses(token, null);
    const initialChoices = initialItems.map((p) => ({ name: p.name, value: p.id }));

    if (opts.list) {
        const matches = opts.query
            ? initialChoices.filter((c) => fuzzyMatch(c.name, opts.query))
            : initialChoices;
        if (isJsonMode()) emitJson({ ok: true, matches });
        else for (const c of matches) log(`${c.value}\t${c.name}`);
        return;
    }

    let selectedId;
    if (opts.id) {
        const match = initialChoices.find((c) => String(c.value) === String(opts.id));
        if (!match) throw new Error(`No LRP process found with id "${opts.id}"`);
        selectedId = match.value;
    } else {
        requireInteractive('use -m/--id <id>');
        let searchController = null;

        selectedId = await search({
            message: 'Select LRP process to export:',
            source: async (input) => {
                if (!input) return initialChoices;

                if (searchController) searchController.abort();
                searchController = new AbortController();

                try {
                    const items = await fetchProcesses(token, input, searchController.signal);
                    return items.map((p) => ({ name: p.name, value: p.id }));
                } catch {
                    return initialChoices;
                }
            },
        });
    }

    log('Fetching process detail...');
    const jsText = await fetchProcessDetail(selectedId, token);
    const { xml, filename } = extractBpmnData(jsText);
    const bpmnFilename = `${filename}.bpmn20.xml`;
    // Older exports stripped the tenant prefix, so a few processes are still
    // tracked under an unprefixed filename. Update those in place rather than
    // dropping a prefixed duplicate next to them.
    const legacyFilename = filename.startsWith('B2WA_')
        ? `${filename.slice('B2WA_'.length)}.bpmn20.xml`
        : null;

    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const processesDir = path.join(ADDONS_PATH, '.cloudbuild', 'symphony', 'B2WA', 'processes');

    let existing = await findExistingFile(processesDir, bpmnFilename);
    if (!existing && legacyFilename) {
        existing = await findExistingFile(processesDir, legacyFilename);
        if (existing) {
            log(
                `Note: updating legacy unprefixed file ${existing} — consider renaming it to ${bpmnFilename}.`
            );
        }
    }

    let savePath;
    let action;
    if (existing) {
        savePath = existing;
        action = 'updated';
        await fs.writeFile(savePath, xml, 'utf-8');
        log(`Updated: ${savePath}`);
    } else {
        savePath = path.join(processesDir, 'all', bpmnFilename);
        action = 'created';
        await fs.mkdir(path.dirname(savePath), { recursive: true });
        await fs.writeFile(savePath, xml, 'utf-8');
        log(`Created: ${savePath}`);
    }

    if (opts.commit !== false) {
        await execGit(['add', savePath], ADDONS_PATH);
        await execGit(
            ['commit', '-m', '[IMP][.cloudbuild] Update long running process'],
            ADDONS_PATH
        );
        log('Committed.');
    }

    if (isJsonMode()) {
        emitJson({
            ok: true,
            id: selectedId,
            filename: path.basename(savePath),
            savePath,
            action,
            committed: opts.commit !== false,
        });
    }
}

export { exportLrp };
