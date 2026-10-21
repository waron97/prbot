import search from '@inquirer/search';
import { listProcesses, publishProcess } from '../agrippa/lib/pbApi.js';
import { getToken } from '../lib/auth.js';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { emitJson, isJsonMode, log } from '../lib/logger.js';
import { requireInteractive } from '../lib/tty.js';

// Publishes one wizard by guid. Same PB endpoint the UI's Publish button and
// `agrippa publish` hit; the response lists the BPMN deployment(s) produced.
async function publishWizard(token, guid) {
    const deployments = (await publishProcess(token, guid)) ?? [];
    for (const d of deployments) log(`  deployed ${d.fileName} (${d.id})`);
    return deployments;
}

// Unpublished wizards first, so the ones that actually need publishing are on top.
function sortForPublish(processes) {
    const rank = (p) => (p.status === 'published' ? 1 : 0);
    return [...processes].sort((a, b) => rank(a) - rank(b));
}

// Fuzzy filtering matches on name + id only; the status suffix is display-only.
function searchKey(p) {
    return `${p.process_name} (${p.document_id})`;
}

function label(p) {
    return `${searchKey(p)} [${p.status}]`;
}

async function publishPb(opts) {
    // Fail before any network call when an agent forgot the selector.
    if (!opts.list && !opts.id) requireInteractive('use -m/--id <document_id>');
    const token = await getToken();
    const processes = sortForPublish(await listProcesses(token));

    if (opts.list) {
        const matches = opts.query
            ? processes.filter((p) => fuzzyMatch(searchKey(p), opts.query))
            : processes;
        if (isJsonMode()) emitJson({ ok: true, matches });
        else for (const p of matches) log(`${p.document_id}\t${p.status}\t${p.process_name}`);
        return;
    }

    let selected;
    if (opts.id) {
        selected = processes.find((p) => p.document_id === opts.id);
        if (!selected) throw new Error(`No PB process found with document_id "${opts.id}"`);
    } else {
        const choices = processes.map((p) => ({ name: label(p), key: searchKey(p), value: p }));
        selected = await search({
            message: 'Select PB process to publish:',
            source: async (input) =>
                input ? choices.filter((c) => fuzzyMatch(c.key, input)) : choices,
        });
    }

    log(`Publishing ${selected.document_id} (was ${selected.status})...`);
    const deployments = await publishWizard(token, selected.guid);
    log('Published.');

    if (isJsonMode()) {
        emitJson({
            ok: true,
            documentId: selected.document_id,
            guid: selected.guid,
            previousStatus: selected.status,
            deployments,
        });
    }
}

export { publishPb, publishWizard };
