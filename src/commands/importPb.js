import fs from 'fs/promises';
import path from 'path';
import search from '@inquirer/search';
import fetch from 'node-fetch';
import { resolveAddonsPath } from '../lib/addons.js';
import { getToken } from '../lib/auth.js';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { emitJson, isJsonMode, log, warn } from '../lib/logger.js';
import { requireInteractive } from '../lib/tty.js';
import { publishWizard } from './publishPb.js';

const PROCESSES_REL = path.join('.cloudbuild', 'pb', 'B2WA', 'processes');

function ieBase() {
    const base = process.env.IMPORTEXPORT_URL;
    if (!base) throw new Error('IMPORTEXPORT_URL is not configured. Run `prbot init`.');
    return base.replace(/\/+$/, '');
}

async function ieRequest(urlPath, token, body) {
    const response = await fetch(`${ieBase()}${urlPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(
            `ImportExport POST ${urlPath} failed with ${response.status}: ${await response.text()}`
        );
    }
    return response.json();
}

async function listZips(dir) {
    const out = [];
    async function walk(d) {
        let entries;
        try {
            entries = await fs.readdir(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.name.endsWith('.zip')) out.push(full);
        }
    }
    await walk(dir);
    return out.sort();
}

async function repoZips() {
    const addonsPath = resolveAddonsPath(process.env.ADDONS_PATH);
    const processesDir = path.join(addonsPath, PROCESSES_REL);
    return { processesDir, zips: await listZips(processesDir) };
}

async function resolveZip(opts) {
    if (opts.file) return path.resolve(opts.file);

    const { processesDir, zips } = await repoZips();

    if (opts.id) {
        const match = zips.find((z) => path.basename(z) === `${opts.id}.zip`);
        if (!match) throw new Error(`No ${opts.id}.zip found under ${processesDir}`);
        return match;
    }

    requireInteractive('use -m/--id <document_id> or -f/--file <path>');
    const choices = zips.map((z) => ({ name: path.relative(processesDir, z), value: z }));
    return search({
        message: 'Select PB zip to import:',
        source: async (input) =>
            input ? choices.filter((c) => fuzzyMatch(c.name, input)) : choices,
    });
}

// Unlike export, the import call hands back a requestId, so the history row
// is matched on that exactly — no guid/date-window heuristic needed.
const PB_IMPORT_POLL_INTERVAL_MS = 3_000;
const PB_IMPORT_POLL_TIMEOUT_MS = 180_000;

async function pollImportResult(requestId, token) {
    const deadline = Date.now() + PB_IMPORT_POLL_TIMEOUT_MS;
    while (true) {
        if (Date.now() > deadline) {
            throw new Error(
                `REMOTE_TIMEOUT: Process Builder import ${requestId} did not complete within ${
                    PB_IMPORT_POLL_TIMEOUT_MS / 1000
                }s`
            );
        }
        await new Promise((r) => setTimeout(r, PB_IMPORT_POLL_INTERVAL_MS));

        const { data } = await ieRequest(
            '/export/info/processKey=Import&status=FAILED,COMPLETED,WARNING',
            token,
            { page: 1, size: 25, sorters: [] }
        );
        const match = data.find((item) => item.requestId === requestId);
        if (!match) continue;
        if (match.status === 'FAILED' || match.hasError) {
            throw new Error(
                `Import ${requestId} failed: ${match.errorMessage || `status ${match.status}`}`
            );
        }
        return match;
    }
}

async function importPb(opts) {
    if (opts.list) {
        const { processesDir, zips } = await repoZips();
        const rows = zips.map((z) => ({
            documentId: path.basename(z, '.zip'),
            path: path.relative(processesDir, z),
        }));
        const matches = opts.query ? rows.filter((r) => fuzzyMatch(r.path, opts.query)) : rows;
        if (isJsonMode()) emitJson({ ok: true, processesDir, matches });
        else for (const r of matches) log(`${r.documentId}\t${r.path}`);
        return;
    }

    const zipPath = await resolveZip(opts);
    const zip = await fs.readFile(zipPath);
    const token = await getToken();

    log(`Uploading ${zipPath}...`);
    const { requestId } = await ieRequest('/symphony/import', token, {
        payload: zip.toString('base64'),
    });
    if (!requestId) throw new Error('Import request returned no requestId');
    log(`Request ID: ${requestId}`);

    log('Waiting for import to complete...');
    const job = await pollImportResult(requestId, token);
    if (job.status === 'WARNING') {
        warn(`Warning: import completed with warnings: ${job.errorMessage || '(no message)'}`);
    }

    const info = job.customResponse ?? {};
    const guid = info.object_guid;
    const documentId = info.process_builder?.record_imported?.[0]?.document_id;
    log(`Imported ${info.name ?? guid}${documentId ? ` (${documentId})` : ''} as draft.`);

    let deployments = null;
    if (opts.publish === false) {
        log('Skipping publish (--no-publish).');
    } else if (info.object_name !== 'process_builder' || !guid) {
        warn(
            `Warning: import result is not a process_builder wizard (${info.object_name}); not publishing.`
        );
    } else {
        log('Publishing...');
        deployments = await publishWizard(token, guid);
        log('Published.');
    }

    if (isJsonMode()) {
        emitJson({
            ok: true,
            zipPath,
            requestId,
            status: job.status,
            warning: job.status === 'WARNING' ? job.errorMessage || null : null,
            guid,
            documentId: documentId ?? null,
            name: info.name ?? null,
            published: deployments !== null,
            deployments,
        });
    }
}

export { importPb };
