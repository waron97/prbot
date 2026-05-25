import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import search from '@inquirer/search';
import { getToken } from '../lib/auth.js';
import { execGit } from '../lib/git.js';
import { resolveAddonsPath } from '../lib/addons.js';
import { fuzzyMatch } from '../lib/fuzzy.js';

async function getWorkflows(token) {
    const url = `${process.env.RIP_URL}/symple.workflow/*`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
}

async function getEmailTemplates(workflowId, token) {
    const url = `${process.env.RIP_URL}/symple.workflow/get_email_templates`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workflow_id: workflowId }),
    });
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
}

const VOID_ELEMENTS = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

function sanitizeBodyHtml(html) {
    // Convert bare void-element tags to self-closing so the XML stays valid.
    // Also replace &nbsp; which is not a predefined XML entity.
    return html
        .replace(/&nbsp;/g, '&#160;')
        .replace(/<([a-zA-Z]+)(\s[^>]*[^/]|[^/>]*)>/g, (match, tag, attrs) => {
            if (!VOID_ELEMENTS.test(tag)) return match;
            return `<${tag}${attrs ?? ''}/>`;
        });
}

function toXmlId(name) {
    return name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function escapeXml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function generateXml(templates) {
    const records = templates
        .map((t) => {
            const id = `mail_template_${toXmlId(t.template_code)}`;
            const modelRef = Object.values(t.model_id)[0];
            return `        <record id="${id}" model="mail.template">
            <field name="name">${escapeXml(t.name)}</field>
            <field name="model_id" ref="${modelRef}"/>
            <field name="template_code">${escapeXml(t.template_code)}</field>
            <field name="subject">${escapeXml(t.subject)}</field>
            <field name="email_from">${escapeXml(t.email_from)}</field>
            <field name="email_to">${escapeXml(t.email_to)}</field>
            <field name="body_html" type="html">
                ${sanitizeBodyHtml(t.body_html)}
            </field>
        </record>`;
        })
        .join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <data noupdate="1">
${records}
    </data>
</odoo>
`;
}

async function getModuleChoices() {
    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const configDir = path.join(ADDONS_PATH, 'config');
    const entries = await fs.readdir(configDir, { withFileTypes: true });
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, value: e.name }));
}

async function exportEmailTemplates(opts) {
    const token = await getToken();

    const moduleChoices = await getModuleChoices();
    const moduleMatch = opts.module ? moduleChoices.find((c) => c.name === opts.module) : null;
    const module = moduleMatch
        ? moduleMatch.value
        : await search({
              message: 'Select module:',
              source: async (input) => {
                  if (!input) return moduleChoices;
                  return moduleChoices.filter((c) => fuzzyMatch(c.name, input));
              },
          });

    console.log('Fetching workflows...');
    const workflows = await getWorkflows(token);
    const choices = workflows.map((w) => ({ name: w.name, value: w.id }));

    const workflowMatch = opts.workflow
        ? workflows.find((w) => w.name === opts.workflow || String(w.id) === opts.workflow)
        : null;
    const workflowId = workflowMatch
        ? workflowMatch.id
        : await search({
              message: 'Select workflow:',
              source: async (input) => {
                  if (!input) return choices;
                  return choices.filter((c) => fuzzyMatch(c.name, input));
              },
          });

    console.log(`Fetching email templates for workflow ${workflowId}...`);
    const excludes = opts.exclude ?? [];
    const templates = (await getEmailTemplates(workflowId, token))
        .filter((t) => t.template_code)
        .filter((t) => {
            return !excludes.some((ex) => ex === String(t.id) || ex === t.name || ex === t.template_code);
        });

    if (!templates.length) {
        console.log('No email templates found for this workflow.');
        return;
    }

    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const dataDir = path.join(ADDONS_PATH, 'config', module, 'data');
    await fs.mkdir(dataDir, { recursive: true });

    const outPath = path.join(dataDir, 'mail_template.xml');
    await fs.writeFile(outPath, generateXml(templates), 'utf-8');
    console.log(`Written: ${outPath}`);

    if (opts.commit !== false) {
        await execGit(['add', outPath], ADDONS_PATH);
        await execGit(
            ['commit', '-m', `[IMP][${module}] Export email templates`],
            ADDONS_PATH,
        );
        console.log('Committed.');
    }
}

export { exportEmailTemplates };
