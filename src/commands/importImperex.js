import fs from 'fs/promises';
import path from 'path';
import search from '@inquirer/search';
import fetch from 'node-fetch';
import { resolveAddonsPath } from '../lib/addons.js';
import { getToken } from '../lib/auth.js';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { emitJson, error, isJsonMode, log, warn } from '../lib/logger.js';
import { fuzzyMultiSelect } from '../lib/prompt.js';
import { requireInteractive } from '../lib/tty.js';
import { getModels, IMPEREX_REL } from './exportImperex.js';

async function getModelFiles(addonsPath, model) {
    const dir = path.join(addonsPath, IMPEREX_REL, model);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
        .filter((e) => e.isFile() && e.name.endsWith('.yaml'))
        .map((e) => e.name)
        .sort();
}

async function readFiles(addonsPath, model, files) {
    const dir = path.join(addonsPath, IMPEREX_REL, model);
    return Promise.all(
        files.map(async (name) => ({
            name,
            content: await fs.readFile(path.join(dir, name), 'utf-8'),
        }))
    );
}

// Custom MFA (rip.model.function.access `prbot_imperex_import` on
// helpdesk.ticket): loads + merges the YAML files and runs imperex.import.do()
// in one savepoint — rolled back on any error, or always with dry_run. No
// manifest is sent, so the environment's system manifest supplies the xid rules.
// (The built-in rip_imperex `upload` endpoint passes a `clean_before` kwarg
// that imperex.import.do() no longer accepts, so it can't be used.)
async function upload(files, token, dryRun) {
    const base = process.env.RIP_URL;
    if (!base) throw new Error('RIP_URL is not configured. Run `prbot init`.');
    const response = await fetch(
        `${base.replace(/\/+$/, '')}/helpdesk.ticket/prbot_imperex_import`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ files, dry_run: Boolean(dryRun) }),
        }
    );
    const text = await response.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = text;
    }
    return { ok: response.ok, status: response.status, body };
}

function collectMessages(body) {
    const items = body?.result;
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const item of items) {
        for (const m of item?.messages ?? []) {
            out.push({ model: item.model ?? null, type: m.type, message: m.message });
        }
    }
    return out;
}

function printMessages(messages) {
    let lastModel;
    for (const m of messages) {
        if (m.model && m.model !== lastModel) {
            log(`[${m.model}]`);
            lastModel = m.model;
        }
        const line = `  ${m.type}: ${m.message}`;
        if (m.type === 'error') error(line);
        else if (m.type === 'warning') warn(line);
        else log(line);
    }
}

async function pickModel(models, opts) {
    const choices = models.map((m) => ({ name: m, value: m }));
    if (opts.model) {
        if (!models.includes(opts.model))
            throw new Error(`No Imperex model found named "${opts.model}"`);
        return opts.model;
    }
    requireInteractive('use --model <name>');
    return search({
        message: 'Select Imperex model:',
        source: async (input) =>
            input ? choices.filter((c) => fuzzyMatch(c.name, input)) : choices,
    });
}

async function pickFiles(available, model, opts) {
    if (opts.all) return available;
    if (opts.file?.length) {
        return opts.file.map((f) => {
            const name = f.endsWith('.yaml') ? f : `${f}.yaml`;
            if (!available.includes(name))
                throw new Error(`No file "${name}" found for model "${model}"`);
            return name;
        });
    }
    requireInteractive('use --file <name> (repeatable) or --all');
    return fuzzyMultiSelect({ message: `Select ${model} files to import:`, items: available });
}

async function importImperex(opts) {
    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const models = await getModels(ADDONS_PATH);

    if (opts.list && !opts.model) {
        const matches = opts.query ? models.filter((m) => fuzzyMatch(m, opts.query)) : models;
        if (isJsonMode()) emitJson({ ok: true, models: matches });
        else for (const m of matches) log(m);
        return;
    }

    const model = await pickModel(models, opts);
    const available = await getModelFiles(ADDONS_PATH, model);

    if (opts.list) {
        const matches = opts.query ? available.filter((f) => fuzzyMatch(f, opts.query)) : available;
        if (isJsonMode()) emitJson({ ok: true, model, files: matches });
        else for (const f of matches) log(f);
        return;
    }

    const files = await pickFiles(available, model, opts);
    if (!files.length) throw new Error('No files selected; nothing to import.');

    const payload = await readFiles(ADDONS_PATH, model, files);
    const token = await getToken();

    log(`${opts.dryRun ? 'Dry-run importing' : 'Importing'} ${files.length} ${model} file(s)...`);
    const { ok, status, body } = await upload(payload, token, opts.dryRun);
    const messages = collectMessages(body);
    if (!isJsonMode()) printMessages(messages);

    if (!ok) {
        const errors = messages.filter((m) => m.type === 'error').map((m) => m.message);
        const detail =
            [body?.error, ...errors].filter(Boolean).join('; ') ||
            (typeof body === 'string' ? body : JSON.stringify(body));
        throw new Error(`Imperex import failed (${status}): ${detail || 'see messages above'}`);
    }

    if (isJsonMode()) {
        emitJson({ ok: true, model, files, dryRun: Boolean(opts.dryRun), messages });
    }
}

export { importImperex };
