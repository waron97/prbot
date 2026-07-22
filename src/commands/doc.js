import fs from 'fs/promises';
import path from 'path';
import { htmlToMarkdown } from '../lib/html.js';
import { log, warn } from '../lib/logger.js';
import { tridentRpc } from '../lib/trident.js';

async function fetchTaskDoc(taskId) {
    const id = parseInt(taskId, 10);
    const [task] = await tridentRpc('project.task', 'read', [[id]], {
        fields: ['name', 'description'],
    });
    if (!task) throw new Error(`Task ${taskId} not found`);

    const attachments = await tridentRpc(
        'ir.attachment',
        'search_read',
        [
            [
                ['res_model', '=', 'project.task'],
                ['res_id', '=', id],
            ],
        ],
        { fields: ['name', 'datas', 'mimetype'] }
    );

    return { task, attachments };
}

// Strips path separators from an Odoo attachment name and de-dupes against
// names already written into the same folder.
function safeFilename(name, usedNames) {
    const cleaned = (name || 'attachment').replace(/[/\\]/g, '_').trim() || 'attachment';
    if (!usedNames.has(cleaned)) {
        usedNames.add(cleaned);
        return cleaned;
    }
    const ext = path.extname(cleaned);
    const base = cleaned.slice(0, cleaned.length - ext.length);
    let i = 2;
    let candidate = `${base} (${i})${ext}`;
    while (usedNames.has(candidate)) {
        i += 1;
        candidate = `${base} (${i})${ext}`;
    }
    usedNames.add(candidate);
    return candidate;
}

async function writeTaskDoc(taskId, { task, attachments }) {
    const dirName = `trident_${taskId}`;
    const dir = path.join(process.cwd(), dirName);
    await fs.mkdir(dir, { recursive: true });

    const usedNames = new Set();
    const writtenFiles = [];
    for (const att of attachments) {
        if (!att.datas) {
            warn(`Warning: skipping attachment "${att.name}" (no downloadable content)`);
            continue;
        }
        const filename = safeFilename(att.name, usedNames);
        await fs.writeFile(path.join(dir, filename), Buffer.from(att.datas, 'base64'));
        writtenFiles.push(filename);
    }

    const taskUrl = `${process.env.TRIDENT_URL}/odoo/my-tasks/${taskId}`;
    const lines = [`# ${task.name}`, '', taskUrl, ''];
    const body = htmlToMarkdown(task.description);
    if (body) lines.push(body, '');

    lines.push('## Attachments');
    if (writtenFiles.length === 0) {
        lines.push('', '_None_');
    } else {
        lines.push('', ...writtenFiles.map((f) => `- [${f}](./${f})`));
    }

    await fs.writeFile(path.join(dir, `${dirName}.md`), lines.join('\n') + '\n');
    return dir;
}

async function doc(opts) {
    const ids = opts.trident ?? [];
    if (ids.length === 0) throw new Error('No Trident id: provide -t <id>');

    for (const id of ids) {
        const data = await fetchTaskDoc(id);
        const dir = await writeTaskDoc(id, data);
        log(`Wrote ${dir}`);
    }
}

export { doc };
