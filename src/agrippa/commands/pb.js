// `agrippa pb` — local editing helpers for a cloned process-builder wizard.
//
// All of these operate purely on the local decomposed project (no network):
//   format      auto-lay-out the diagram (elkjs) → rewrite layout/waypoints
//   add         add a node (+ scaffold script/page/manifest), stub geometry
//   rm          remove a node, its edges, and its script/page files
//   connect     add a sequenceFlow between two nodes
//   disconnect  remove a sequenceFlow
//   set-default mark an existing flow as the source gateway's default
//   ls          list nodes/edges (so an agent can discover ids without the YAML)
//   map         text render of the current geometry (rows, positions, gaps)
//   route       recompute a flow's waypoints without moving any node
//   place       position a node relative to another, on a row
//   space       open (or close) a gap across a row or the whole diagram
//   compact     pull a row's over-wide gaps back in
//   layout      dump/apply a whole-diagram layout spec
//
// Structural mutations stub geometry; either place the new node with the layout
// commands above, or run `pb format` to re-lay-out everything. The project is
// resolved from the workspace by document_id (--pb), an explicit --path, a
// single-entry auto-select, or a fuzzy prompt.

import { execFile } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { promisify } from 'util';
import search from '@inquirer/search';
import { parse as yamlParse } from 'yaml';
import { fuzzyMatch } from '../../lib/fuzzy.js';
import { log, warn } from '../../lib/logger.js';
import { readConfig } from '../lib/config.js';
import {
    addNode,
    addNodeBetween,
    connect,
    disconnect,
    eachNode,
    lintAll,
    listGraph,
    removeNode,
    setDefault,
} from '../lib/pbEdit.js';
import { autoLayout } from '../lib/pbLayout.js';
import { lintLayout } from '../lib/pbLayoutLint.js';
import { applyLayout, compact, dumpLayout, place, route, space } from '../lib/pbLayoutOps.js';
import { toSvg } from '../lib/pbPreview.js';
import { MANIFEST_FILE, recompose, stringifyStructure, STRUCTURE_FILE } from '../lib/pbProject.js';
import { toTextMap } from '../lib/pbTextMap.js';
import { projectReader } from '../lib/pbWorkspace.js';

// ---------- project resolution ----------

// Resolves against both process-builder wizards and long-running processes —
// `structure.yaml`-level editing is identical for both (see pbEdit.js). PBs
// select by --pb/--name matched against document_id; LRPs have no document_id
// so the same flag matches against name instead.
async function resolveProjectEntry(opts) {
    // An explicit directory bypasses the workspace entirely: `structure.yaml`
    // editing needs nothing from agrippa.yaml, so a project that was never
    // cloned into a workspace (a fixture, a copy under review) is still a valid
    // target for every local command.
    if (opts.path) {
        if (!existsSync(join(opts.path, STRUCTURE_FILE)))
            throw new Error(`no ${STRUCTURE_FILE} in ${opts.path}`);
        return { path: opts.path, name: opts.path, object_type: null };
    }
    const config = readConfig();
    const entries = (config.workspace || []).filter(
        (e) => e.object_type === 'process_builder' || e.object_type === 'long_running_process'
    );
    if (!entries.length) {
        throw new Error(
            'No process-builder wizards or long-running processes in this workspace. ' +
                'Clone one with `agrippa clone --pb` or `agrippa clone --lrp`.'
        );
    }
    const sel = opts.pb || opts.name;
    if (sel) {
        const entry = entries.find((e) => e.document_id === sel || e.name === sel);
        if (!entry) throw new Error(`No cloned project with document_id/name "${sel}"`);
        return entry;
    }
    if (entries.length === 1) return entries[0];
    const entry = await search({
        message: 'Select a cloned project:',
        source: (input) => {
            const list = input
                ? entries.filter(
                      (e) =>
                          fuzzyMatch(e.name, input) ||
                          (e.document_id && fuzzyMatch(e.document_id, input))
                  )
                : entries;
            return list.map((e) => ({
                name: e.document_id ? `${e.name}  (${e.document_id})` : e.name,
                value: e,
            }));
        },
    });
    return entry;
}

async function resolveProjectPath(opts) {
    const entry = await resolveProjectEntry(opts);
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
        warn(`WARNING: project no longer recomposes cleanly: ${e.message}`);
    }
}

const execFileAsync = promisify(execFile);

// Shells out to the workspace's own eslint (scaffolded by `agrippa init`,
// installed by a plain `npm install` in the workspace root) rather than
// linting in-process, so `pb lint` always reflects whatever rules/version
// are actually configured on disk. `cwd` is the workspace root (agrippa.yaml
// always lives in process.cwd() — see lib/config.js), so relative paths
// resolve exactly as `npm run lint` would see them.
//
// Never throws: a workspace that hasn't run `npm install` (or scaffolded
// eslint at all) is a normal, expected state, not a `pb lint` failure — any
// way script-linting can't run degrades to "no script issues" plus a warning,
// so the structural checks below still run and still produce a trustworthy
// exit code.
async function runScriptEslint(dir) {
    const scriptsDir = join(dir, 'scripts');
    if (!existsSync(scriptsDir)) return [];

    const eslintBin = join(
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'eslint.cmd' : 'eslint'
    );
    if (!existsSync(eslintBin)) {
        warn(
            '  ! script lint skipped: eslint is not installed in this workspace ' +
                '(run `agrippa init` then `npm install` at the workspace root).'
        );
        return [];
    }

    let stdout;
    try {
        ({ stdout } = await execFileAsync(eslintBin, [scriptsDir, '--format', 'json'], {
            cwd: process.cwd(),
            maxBuffer: 10 * 1024 * 1024,
        }));
    } catch (e) {
        // eslint exits 1 when it finds lint errors; the JSON report is still on stdout.
        if (!e.stdout) {
            warn(`  ! script lint skipped: eslint failed to run (${e.stderr || e.message}).`);
            return [];
        }
        stdout = e.stdout;
    }

    let results;
    try {
        results = JSON.parse(stdout || '[]');
    } catch (e) {
        warn(`  ! script lint skipped: could not parse eslint output (${e.message}).`);
        return [];
    }

    const issues = [];
    for (const file of results) {
        const rel = relative(process.cwd(), file.filePath);
        for (const msg of file.messages) {
            issues.push(
                `${rel}:${msg.line}:${msg.column}  ${msg.message} (${msg.ruleId || 'parse-error'})`
            );
        }
    }
    return issues;
}

// ---------- commands ----------

// `--elk key=value` (repeatable) passes raw ELK layout options through to the
// engine, so trying one is a flag rather than an edit to pbLayout.js and a
// `git checkout` to undo it.
function parseElkOptions(pairs) {
    const opts = {};
    for (const pair of pairs || []) {
        const at = pair.indexOf('=');
        if (at < 1)
            throw new Error(
                `--elk expects key=value, got "${pair}" (e.g. --elk elk.direction=DOWN)`
            );
        opts[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
    }
    return opts;
}

function parseIdList(value) {
    return String(value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

async function pbFormat(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    await autoLayout(structure, {
        elkOptions: parseElkOptions(opts.elk),
        happy: opts.happy ? parseIdList(opts.happy) : undefined,
        noHappy: opts.happy === false || opts.noHappy === true,
    });
    saveStructure(dir, structure);

    let nodes = 0;
    let missing = 0;
    eachNode(structure.nodes, null, (n) => {
        nodes++;
        if (!n.layout) missing++;
    });
    validate(dir);
    log(
        `Formatted ${dir} (${nodes} node(s) laid out${missing ? `, ${missing} without layout` : ''}).`
    );
    const issues = lintAll(structure);
    if (issues.length) {
        warn('Diagram issues:');
        for (const w of issues) warn(`  ! ${w}`);
    }
}

async function pbAdd(opts) {
    if (!opts.type)
        throw new Error(
            '--type is required (e.g. scriptTask, serviceTask, userTask, exclusiveGateway, subProcess, endEvent, callActivity...)'
        );
    if ((opts.from || opts.to) && !(opts.from && opts.to))
        throw new Error('--from and --to must be used together');
    if (opts.from && opts.parent)
        throw new Error('--parent is implied by --from/--to; pass only one');

    const projectEntry = await resolveProjectEntry(opts);
    if (opts.type === 'userTask' && projectEntry.object_type === 'long_running_process') {
        throw new Error(
            'userTask is not valid on a long-running process — LRPs have no pages (user tasks are a process-builder-only concept).'
        );
    }
    const dir = projectEntry.path;
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
        log(
            `Added ${result.type} ${result.id}${result.file ? ` (${result.file})` : ''} between ${opts.from} → ${opts.to}.`
        );
        log(`  ${opts.from} → ${result.id}  (${result.edgeId}, retargeted)`);
        log(`  ${result.id} → ${opts.to}  (${result.newEdgeId})`);
        for (const w of result.warnings || []) warn(`  ! ${w}`);
        log('Run `agrippa pb format` to lay it out.');
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
    log(`Added ${result.type} ${result.id}${result.file ? ` (${result.file})` : ''}.`);
    log('Connect it with `agrippa pb connect`, then run `agrippa pb format` to lay it out.');
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
    log(
        `Removed ${result.removed.length} node(s) [${result.removed.join(', ')}], ` +
            `${result.removedEdges} dangling edge(s), ${deletes.length} file(s).`
    );
    for (const c of result.clearedDefaults || [])
        log(`  cleared dangling default ${c.edge} on ${c.node}.`);
    for (const attachedId of result.removedAttached || [])
        log(`  cascaded boundary event ${attachedId} (was attached to the removed node).`);
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
    log(
        `Connected ${result.from} → ${result.to} (${result.id})${opts.default ? ' [default]' : ''}.`
    );
    for (const w of result.warnings || []) warn(`  ! ${w}`);
    log('Run `agrippa pb format` to route it.');
}

async function pbDisconnect(opts) {
    if (!opts.id && !(opts.from && opts.to))
        throw new Error('provide --id, or both --from and --to');
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const { result } = disconnect(structure, { id: opts.id, from: opts.from, to: opts.to });
    saveStructure(dir, structure);
    validate(dir);
    log(`Removed ${result.removed} edge(s)${result.id ? ` (${result.id})` : ''}.`);
    for (const c of result.clearedDefaults || [])
        log(`  cleared dangling default ${c.edge} on ${c.node}.`);
}

async function pbSetDefault(opts) {
    if (!opts.id && !(opts.from && opts.to))
        throw new Error('provide --id, or both --from and --to');
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const { result } = setDefault(structure, { id: opts.id, from: opts.from, to: opts.to });
    saveStructure(dir, structure);
    validate(dir);
    log(
        `Default flow on ${result.from} is now ${result.id} (→ ${result.to})` +
            `${result.prev && result.prev !== result.id ? `, was ${result.prev}` : ''}.`
    );
    for (const w of result.warnings || []) warn(`  ! ${w}`);
}

async function pbList(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const rows = listGraph(structure);
    for (const r of rows) {
        const where = r.parent ? `  [in ${r.parent}]` : '';
        const label = r.name ? `  "${r.name}"` : '';
        log(`${r.id}  (${r.type})${label}${where}`);
        for (const e of r.edges) {
            const tag = [
                e.isDefault && '[default]',
                e.name && `"${e.name}"`,
                e.condition && `if ${e.condition}`,
            ]
                .filter(Boolean)
                .join(' ');
            log(`    → ${e.target}  (${e.id})${tag ? `  ${tag}` : ''}`);
        }
    }
    log(`\n${rows.length} node(s).`);
}

async function pbPreview(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const svg = toSvg(structure);
    const out = opts.out || join(dir, 'preview.svg');
    writeFileSync(out, svg, 'utf-8');
    log(`Wrote ${out} (${svg.length} bytes).`);
}

// ---------- layout commands ----------
//
// These are the middle ground between `pb connect` (stub geometry, defer
// everything) and `pb format` (rebuild every coordinate). They only ever write
// layout/waypoints/labelPos, they re-route what they touch, and they leave the
// rest of the diagram exactly as it was — so unlike `format` they are safe on a
// hand-tuned project.

function reportRouting(result) {
    const { rerouted = [], unchanged = [], skipped = [] } = result;
    log(
        `Re-routed ${rerouted.length} flow(s)` +
            (unchanged.length ? `, ${unchanged.length} already correct` : '') +
            '.'
    );
    for (const s of skipped) warn(`  ! skipped ${s.id}: ${s.why}`);
}

async function pbMap(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    log(
        toTextMap(structure, {
            ids: !!opts.ids,
            lane: opts.lane === undefined ? undefined : Number(opts.lane),
        })
    );
    const issues = lintLayout(structure);
    if (issues.length) {
        warn('');
        warn('Layout issues:');
        for (const w of issues) warn(`  ! ${w}`);
    }
    if (!opts.ids) log('\n(names shown; pass --ids for node ids)');
}

function parseVia(value) {
    if (!value) return undefined;
    const [x, y] = String(value).split(',').map(Number);
    if (Number.isNaN(x) || Number.isNaN(y))
        throw new Error('--via expects x,y (e.g. --via 640,120)');
    return [x, y];
}

async function pbRoute(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const result = route(structure, {
        id: opts.id,
        from: opts.from,
        to: opts.to,
        all: !!opts.all,
        touching: opts.touching ? parseIdList(opts.touching) : undefined,
        via: parseVia(opts.via),
    });
    saveStructure(dir, structure);
    validate(dir);
    reportRouting(result);
}

async function pbPlace(opts) {
    if (!opts.id) throw new Error('--id is required');
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const result = place(structure, {
        id: opts.id,
        lane: opts.lane,
        after: opts.after,
        before: opts.before,
        at: opts.at,
        gap: opts.gap === undefined ? undefined : Number(opts.gap),
        push: !!opts.push,
    });
    saveStructure(dir, structure);
    validate(dir);
    log(`Placed ${result.id} at x=${result.x}, y=${result.y} (row y=${result.cy}).`);
    if (result.pushed.length) log(`  pushed ${result.pushed.length} node(s) right to make room.`);
    log(`  re-routed ${result.rerouted.length} attached flow(s).`);
}

async function pbSpace(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const result = space(structure, {
        after: opts.after,
        atX: opts.atX,
        by: opts.by === undefined ? undefined : Number(opts.by),
        lane: opts.lane,
    });
    saveStructure(dir, structure);
    validate(dir);
    log(
        `Shifted ${result.moved.length} node(s) by ${result.by}px from x=${result.fromX} ` +
            `(width ${result.widthBefore} -> ${result.widthAfter}).`
    );
    log(`  re-routed ${result.rerouted.length} flow(s).`);
}

async function pbCompact(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const result = compact(structure, {
        lane: opts.lane,
        all: !!opts.all,
        after: opts.after,
        from: opts.from,
        to: opts.to,
        gap: opts.gap === undefined ? undefined : Number(opts.gap),
        uniform: !!opts.uniform,
    });
    saveStructure(dir, structure);
    validate(dir);
    log(`Closed ${result.closed.length} gap(s), moved ${result.moved.length} node(s).`);
    for (const c of result.closed) log(`  ${c.before} -> ${c.after}: ${c.from}px -> ${c.to}px`);
    log(`  re-routed ${result.rerouted.length} flow(s).`);
}

async function pbLayoutDump(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const spec = dumpLayout(structure, {
        gap: opts.gap === undefined ? undefined : Number(opts.gap),
    });
    if (opts.out) {
        writeFileSync(opts.out, spec, 'utf-8');
        log(`Wrote ${opts.out}.`);
    } else {
        log(spec);
    }
}

async function pbLayoutApply(file, opts) {
    if (!file) throw new Error('provide the spec file (from `pb layout dump`)');
    if (!existsSync(file)) throw new Error(`no such spec file: ${file}`);
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const result = applyLayout(structure, readFileSync(file, 'utf-8'), {
        gap: opts.gap === undefined ? undefined : Number(opts.gap),
    });
    saveStructure(dir, structure);
    validate(dir);
    log(
        `Placed ${result.placed} node(s) across ${result.rows} row(s)` +
            `${result.untouched ? `, left ${result.untouched} untouched` : ''} ` +
            `(width ${result.widthBefore} -> ${result.widthAfter}).`
    );
    log(`  re-routed ${result.rerouted.length} flow(s).`);
    for (const s of result.skipped) warn(`  ! skipped ${s.id}: ${s.why}`);
    const issues = lintLayout(structure);
    if (issues.length) {
        warn('Layout issues:');
        for (const w of issues) warn(`  ! ${w}`);
    }
}

async function pbLint(opts) {
    const dir = await resolveProjectPath(opts);
    const { structure } = loadProject(dir);
    const issues = lintAll(structure);
    // Geometry rules are opt-in: `pb add`/`pb connect` deliberately leave a
    // placeholder position and a stub waypoint, so running these by default
    // would report the expected intermediate state as a failure.
    const layoutIssues = opts.layout
        ? lintLayout(structure, {
              happy: opts.happy ? new Set(parseIdList(opts.happy)) : undefined,
              all: !!opts.allIssues,
          })
        : [];
    const scriptIssues = await runScriptEslint(dir);

    const allIssues = [...issues, ...layoutIssues, ...scriptIssues];
    if (!allIssues.length) {
        log('No issues.');
    } else {
        for (const w of allIssues) warn(`  ! ${w}`);
        process.exitCode = 1;
    }
}

export {
    pbFormat,
    pbAdd,
    pbRemove,
    pbConnect,
    pbDisconnect,
    pbSetDefault,
    pbList,
    pbPreview,
    pbLint,
    pbMap,
    pbRoute,
    pbPlace,
    pbSpace,
    pbCompact,
    pbLayoutDump,
    pbLayoutApply,
};
