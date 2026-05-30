import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import search from '@inquirer/search';
import { getToken } from '../lib/auth.js';
import { execGit } from '../lib/git.js';
import { resolveAddonsPath } from '../lib/addons.js';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { CONFIG_DIR } from '../config.js';

const CACHE_FILE = path.join(CONFIG_DIR, 'lrp_processes_cache.json');

function getSymphonyBase() {
    const url = process.env.IMPORTEXPORT_URL;
    if (!url) throw new Error('IMPORTEXPORT_URL not configured');
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
}

async function fetchProcessList(token, signal) {
    const base = getSymphonyBase();
    const params = encodeURIComponent(JSON.stringify({ page: 1, size: 1000, sorters: [], filters: [] }));
    const otherfilters = encodeURIComponent(
        JSON.stringify([
            { field: 'id', type: '=', value: null },
            { field: 'name', type: 'like', value: null },
            { field: 'tenantId', type: '=', value: null },
            { field: 'latestVersion', type: '=', value: true },
        ])
    );
    const othersort = encodeURIComponent(JSON.stringify({ field: 'lastModifiedDate', dir: 'desc' }));
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

async function loadCache() {
    try {
        const data = await fs.readFile(CACHE_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

async function saveCache(items) {
    try {
        await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
        await fs.writeFile(CACHE_FILE, JSON.stringify(items));
    } catch {
        // non-fatal
    }
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

    // choices is a mutable ref so source() sees background updates live
    let choices = [];

    const cached = await loadCache();

    const bgController = new AbortController();

    if (cached) {
        choices = cached.map((p) => ({ name: p.name, value: p.id }));
        console.log(`Loaded ${choices.length} processes from cache. Fetching fresh list in background (~1 min) — results update as you type.`);
        fetchProcessList(token, bgController.signal)
            .then(async (fresh) => {
                await saveCache(fresh);
                const updated = fresh.map((p) => ({ name: p.name, value: p.id }));
                choices.length = 0;
                choices.push(...updated);
            })
            .catch(() => {});
    } else {
        console.log('No cache found. Fetching process list (~1 min)...');
        const items = await fetchProcessList(token);
        await saveCache(items);
        choices = items.map((p) => ({ name: p.name, value: p.id }));
        console.log(`Loaded ${choices.length} processes.`);
    }

    const selectedId = await search({
        message: 'Select LRP process to export:',
        source: async (input) => {
            if (!input) return choices;
            return choices.filter((c) => fuzzyMatch(c.name, input));
        },
    });

    console.log('Fetching process detail...');
    const jsText = await fetchProcessDetail(selectedId, token);
    const { xml, filename } = extractBpmnData(jsText);
    const bpmnFilename = `${filename.replace(/^B2WA_/, '')}.bpmn20.xml`;

    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const processesDir = path.join(ADDONS_PATH, '.cloudbuild', 'symphony', 'B2WA', 'processes');

    const existing = await findExistingFile(processesDir, bpmnFilename);
    let savePath;
    if (existing) {
        savePath = existing;
        await fs.writeFile(savePath, xml, 'utf-8');
        console.log(`Updated: ${savePath}`);
    } else {
        savePath = path.join(processesDir, 'all', bpmnFilename);
        await fs.mkdir(path.dirname(savePath), { recursive: true });
        await fs.writeFile(savePath, xml, 'utf-8');
        console.log(`Created: ${savePath}`);
    }

    if (opts.commit !== false) {
        await execGit(['add', savePath], ADDONS_PATH);
        await execGit(['commit', '-m', '[IMP][.cloudbuild] Update long running process'], ADDONS_PATH);
        console.log('Committed.');
    }

    bgController.abort();
}

export { exportLrp };
