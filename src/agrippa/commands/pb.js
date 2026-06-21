// `agrippa pb` — local editing helpers for a cloned process-builder wizard.
//
// All of these operate purely on the local decomposed project (no network):
//   format      auto-lay-out the diagram (elkjs) → rewrite layout/waypoints
//   add         add a node (+ scaffold script/page/manifest), stub geometry
//   rm          remove a node, its edges, and its script/page files
//   connect     add a sequenceFlow between two nodes
//   disconnect  remove a sequenceFlow
//   ls          list nodes/edges (so an agent can discover ids without the YAML)
//
// Mutations stub geometry; run `pb format` afterwards to finalize layout. The
// project is resolved from the workspace by document_id (--pb), single-entry
// auto-select, or a fuzzy prompt.

import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import search from '@inquirer/search';
import { parse as yamlParse } from 'yaml';
import { fuzzyMatch } from '../../lib/fuzzy.js';
import { readConfig } from '../lib/config.js';
import {
    addNode,
    addNodeBetween,
    connect,
    disconnect,
    eachNode,
    lintGateways,
    listGraph,
    removeNode,
} from '../lib/pbEdit.js';
import { autoLayout } from '../lib/pbLayout.js';
import { toSvg } from '../lib/pbPreview.js';
import { MANIFEST_FILE, recompose, stringifyStructure, STRUCTURE_FILE } from '../lib/pbProject.js';
import { projectReader } from '../lib/pbWorkspace.js';

// ---------- project resolution ----------

async function resolveProjectPath(opts) {
    const config = readConfig();
    const entries = (config.workspace || []).filter((e) => e.object_type === 'process_builder');
    if (!entries.length) {
        throw new Error(
            'No process-builder wizards in this workspace. Clone one with `agrippa clone --pb`.'
        );
    }
    const sel = opts.pb || opts.name;
    if (sel) {
        const entry = entries.find((e) => e.document_id === sel);
        if (!entry) throw new Error(`No cloned wizard with document_id "${sel}"`);
        return entry.path;
    }
    if (entries.length === 1) return entries[0].path;
    const entry = await search({
        message: 'Select a cloned wizard:',
        source: (input) => {
            const list = input
                ? entries.filter(
                      (e) => fuzzyMatch(e.name, input) || fuzzyMatch(e.document_id, input)
                  )
                : entries;
            return list.map((e) => ({ name: `${e.name}  (${e.document_id})`, value: e }));
        },
    });
    return entry.path;
}

// ---------- disk helpers ----------

function loadProject(dir) {
    const read = projectReader(dir);
    const structure = yamlParse(read(STRUCTURE_FILE));
    const manifest = JSON.parse(read(MANIFEST_FILE));
    return { structure, manifest };
}
function saveStructure(dir, structure) {
    writeFileSync(join(dir, STRUCTURE_FILE), stringifyStructure(structure), 'utf-8');
}
function saveManifest(dir, manifest) {
    writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8');
}
function applyEffects(dir, { writes, deletes }) {
    for (const [rel, content] of Object.entries(writes || {})) {
        const full = join(dir, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content, 'utf-8');
    }
    for (const rel of deletes || []) {
        const full = join(dir, rel);
        if (existsSync(full)) unlinkSync(full);
    }
}
function listScriptFiles(dir) {
    const sdir = join(dir, 'scripts');
    if (!existsSync(sdir)) return [];
    return readdirSync(sdir)
        .filter((f) => f.endsWith('.js'))
        .map((f) => `scripts/${f}`);
}
// Confirm the project still recomposes (graph valid, diagram builds).
function validate(dir) {
    try {
        recompose(projectReader(dir));
    } catch (e) {
        console.warn(`WARNING: project no longer recomposes cleanly: ${e.message}`);
    }
}

// ---------- commands ----------

async function pbFormat(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    await autoLayout(structure);
    saveStructure(dir, structure);

    let nodes = 0;
    let missing = 0;
    eachNode(structure.nodes, null, (n) => {
        nodes++;
        if (!n.layout) missing++;
    });
    validate(dir);
    console.log(
        `Formatted ${dir} (${nodes} node(s) laid out${missing ? `, ${missing} without layout` : ''}).`
    );
    const issues = lintGateways(structure);
    if (issues.length) {
        console.warn('Gateway issues (exclusiveGateway default/condition rule):');
        for (const w of issues) console.warn(`  ! ${w}`);
    }
}

async function pbAdd(opts) {
    if (!opts.type)
        throw new Error(
            '--type is required (e.g. scriptTask, serviceTask, userTask, exclusiveGateway, subProcess, endEvent...)'
        );
    if ((opts.from || opts.to) && !(opts.from && opts.to))
        throw new Error('--from and --to must be used together');
    if (opts.from && opts.parent)
        throw new Error('--parent is implied by --from/--to; pass only one');

    const dir = await resolveProjectPath(opts);
    const { structure, manifest } = loadProject(dir);
    const ctx = { existingScripts: listScriptFiles(dir), documentId: manifest.document_id };

    if (opts.from) {
        const { writes, result } = addNodeBetween(
            structure,
            manifest,
            { from: opts.from, to: opts.to, type: opts.type, name: opts.name },
            ctx
        );
        applyEffects(dir, { writes, deletes: [] });
        saveStructure(dir, structure);
        saveManifest(dir, manifest);
        validate(dir);
        console.log(
            `Added ${result.type} ${result.id}${result.file ? ` (${result.file})` : ''} between ${opts.from} → ${opts.to}.`
        );
        console.log(`  ${opts.from} → ${result.id}  (${result.edgeId}, retargeted)`);
        console.log(`  ${result.id} → ${opts.to}  (${result.newEdgeId})`);
        for (const w of result.warnings || []) console.warn(`  ! ${w}`);
        console.log('Run `agrippa pb format` to lay it out.');
        return;
    }

    const { writes, result } = addNode(
        structure,
        manifest,
        { type: opts.type, name: opts.name, parentId: opts.parent },
        ctx
    );
    applyEffects(dir, { writes, deletes: [] });
    saveStructure(dir, structure);
    saveManifest(dir, manifest);
    validate(dir);
    console.log(`Added ${result.type} ${result.id}${result.file ? ` (${result.file})` : ''}.`);
    console.log(
        'Connect it with `agrippa pb connect`, then run `agrippa pb format` to lay it out.'
    );
}

async function pbRemove(opts) {
    if (!opts.id) throw new Error('--id is required');
    const dir = await resolveProjectPath(opts);
    const { structure, manifest } = loadProject(dir);
    const { deletes, result } = removeNode(structure, manifest, { id: opts.id });
    applyEffects(dir, { writes: {}, deletes });
    saveStructure(dir, structure);
    saveManifest(dir, manifest);
    validate(dir);
    console.log(
        `Removed ${result.removed.length} node(s) [${result.removed.join(', ')}], ` +
            `${result.removedEdges} dangling edge(s), ${deletes.length} file(s).`
    );
}

async function pbConnect(opts) {
    if (!opts.from || !opts.to) throw new Error('--from and --to are required');
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const { result } = connect(structure, {
        from: opts.from,
        to: opts.to,
        name: opts.name,
        condition: opts.condition,
        conditionType: opts.conditionType,
        makeDefault: opts.default,
    });
    saveStructure(dir, structure);
    validate(dir);
    console.log(
        `Connected ${result.from} → ${result.to} (${result.id})${opts.default ? ' [default]' : ''}.`
    );
    for (const w of result.warnings || []) console.warn(`  ! ${w}`);
    console.log('Run `agrippa pb format` to route it.');
}

async function pbDisconnect(opts) {
    if (!opts.id && !(opts.from && opts.to))
        throw new Error('provide --id, or both --from and --to');
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const { result } = disconnect(structure, { id: opts.id, from: opts.from, to: opts.to });
    saveStructure(dir, structure);
    validate(dir);
    console.log(`Removed ${result.removed} edge(s)${result.id ? ` (${result.id})` : ''}.`);
}

async function pbList(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const rows = listGraph(structure);
    for (const r of rows) {
        const where = r.parent ? `  [in ${r.parent}]` : '';
        const label = r.name ? `  "${r.name}"` : '';
        console.log(`${r.id}  (${r.type})${label}${where}`);
        for (const e of r.edges) {
            const tag = [
                e.isDefault && '[default]',
                e.name && `"${e.name}"`,
                e.condition && `if ${e.condition}`,
            ]
                .filter(Boolean)
                .join(' ');
            console.log(`    → ${e.target}  (${e.id})${tag ? `  ${tag}` : ''}`);
        }
    }
    console.log(`\n${rows.length} node(s).`);
}

async function pbPreview(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const svg = toSvg(structure);
    const out = opts.out || join(dir, 'preview.svg');
    writeFileSync(out, svg, 'utf-8');
    console.log(`Wrote ${out} (${svg.length} bytes).`);
}

export { pbFormat, pbAdd, pbRemove, pbConnect, pbDisconnect, pbList, pbPreview };
