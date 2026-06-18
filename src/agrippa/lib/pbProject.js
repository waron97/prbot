// Decompose a process-builder payload into editable files, and recompose it.
//
// Layout (see ai_tasks planning.md):
//   process.yaml      editable scalar overlay (identity + flags)
//   structure.yaml    the authoritative graph (nodes + edges), scripts by ref
//   scripts/NNNN_*.js  one scriptTask body each, byte-exact
//   pages/<formKey>.yml  one userTask page object each
//   .agrippa-pb.json   manifest: all scalars verbatim, ns, diagram, audit, id<->file maps
//
// The manifest carries every top-level scalar verbatim, so nothing is ever lost;
// process.yaml is a friendlier subset that *overrides* the manifest on recompose.

import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import slugify from 'slugify';
import { parseProcess, buildProcess, compareProcess, extractDiagram, diff } from './pbModel.js';

const MANIFEST_FILE = '.agrippa-pb.json';
const STRUCTURE_FILE = 'structure.yaml';
const PROCESS_FILE = 'process.yaml';

// Scalar fields surfaced in process.yaml (editable). Everything else lives in
// the manifest. These override manifest scalars on recompose.
const EDITABLE_SCALARS = [
    'document_id',
    'process_name',
    'version',
    'icon',
    'short_description',
    'status',
    'active',
    'is_linear',
    'execute_save',
    'progressbar_enabled',
    'start_date',
    'end_date',
    'favorite',
];

function toSlug(name) {
    return slugify(String(name ?? ''), { lower: true, strict: true }) || 'node';
}
function pad(n) {
    return String(n).padStart(4, '0');
}
function pick(obj, keys) {
    const o = {};
    for (const k of keys) if (k in obj) o[k] = obj[k];
    return o;
}
function omit(obj, keys) {
    const set = new Set(keys);
    const o = {};
    for (const [k, v] of Object.entries(obj)) if (!set.has(k)) o[k] = v;
    return o;
}

// ---------- decompose: payload -> { files, manifest } ----------

function decompose(payload) {
    const { ns, model, diagramXml } = parseProcess(payload.built_page);
    const files = {};

    // scripts — one file per scriptTask, document order, byte-exact body.
    const scriptsMap = {};
    let seq = 0;
    const usedNames = new Set();
    for (const n of model.nodes) {
        if (n.type !== 'scriptTask') continue;
        seq += 10;
        let base = `${pad(seq)}_${toSlug(n.name || n.id)}`;
        while (usedNames.has(base)) base += '_';
        usedNames.add(base);
        const path = `scripts/${base}.js`;
        files[path] = n.script ?? '';
        scriptsMap[n.id] = path;
    }

    // pages — one file per userTask page object; wrapper audit kept in manifest.
    const pagesMap = {};
    const usedPageNames = new Set();
    for (const wrapper of payload.pages || []) {
        const stepkey = wrapper.page?._id?.stepkey ?? wrapper.name;
        const ut = model.nodes.find((x) => x.type === 'userTask' && x.id === stepkey);
        let fname = toSlug(ut?.formKey || wrapper.name || stepkey);
        while (usedPageNames.has(fname)) fname += '_';
        usedPageNames.add(fname);
        const path = `pages/${fname}.yml`;
        files[path] = yamlStringify(wrapper.page, { lineWidth: 0 });
        pagesMap[stepkey] = { file: path, wrapper: omit(wrapper, ['page']) };
    }

    // structure.yaml — the model, scriptTask bodies swapped for file refs.
    const structure = {
        process: model.process,
        errors: model.errors,
        nodes: model.nodes.map((n) => (n.type === 'scriptTask' ? { ...n, script: scriptsMap[n.id] } : n)),
        edges: model.edges,
        annotations: model.annotations,
        associations: model.associations,
    };
    files[STRUCTURE_FILE] = yamlStringify(structure, { lineWidth: 0 });

    // process.yaml — editable scalar overlay.
    files[PROCESS_FILE] = yamlStringify(pick(payload, EDITABLE_SCALARS), { lineWidth: 0 });

    // manifest — everything needed to rebuild the exact payload.
    const manifest = {
        guid: payload.guid,
        document_id: payload.document_id,
        process_name: payload.process_name,
        scalars: omit(payload, ['built_page', 'pages', 'process_structure']),
        process_structure: payload.process_structure,
        ns,
        diagram: diagramXml,
        scripts: scriptsMap,
        pages: pagesMap,
    };
    files[MANIFEST_FILE] = JSON.stringify(manifest, null, 2);

    return { files, manifest };
}

// ---------- recompose: read(path)->content  ->  payload ----------

function recompose(read) {
    const manifest = JSON.parse(read(MANIFEST_FILE));
    const structure = yamlParse(read(STRUCTURE_FILE));
    const processOverlay = yamlParse(read(PROCESS_FILE)) || {};

    // Rebuild the model; reload script bodies from their files.
    const model = {
        process: structure.process,
        errors: structure.errors || [],
        nodes: (structure.nodes || []).map((n) => {
            if (n.type === 'scriptTask') {
                const path = n.script; // file ref
                return { ...n, script: read(path) };
            }
            return n;
        }),
        edges: structure.edges || [],
        annotations: structure.annotations || [],
        associations: structure.associations || [],
    };

    const built_page = buildProcess({ ns: manifest.ns, model, diagramXml: manifest.diagram });

    // Rebuild pages array in original order.
    const pages = [];
    for (const info of Object.values(manifest.pages)) {
        const pageObj = yamlParse(read(info.file));
        pages.push({ ...info.wrapper, page: pageObj });
    }

    return {
        ...manifest.scalars,
        ...processOverlay,
        built_page,
        pages,
        process_structure: manifest.process_structure,
    };
}

// ---------- verify: decompose -> recompose -> semantic compare ----------
//
// 0-loss bar A: behavioral equivalence. Returns a list of human-readable
// differences (empty array == lossless round-trip).

function comparePayload(payload, rebuilt) {
    const diffs = [];

    // 1. logic graph (<process> subtree), formatting-insensitive
    const procDiff = compareProcess(payload.built_page, rebuilt.built_page);
    if (procDiff) diffs.push(`built_page <process>: ${procDiff}`);

    // 2. diagram geometry — spliced verbatim, must match exactly
    if (extractDiagram(payload.built_page) !== extractDiagram(rebuilt.built_page)) {
        diffs.push('built_page <bpmndi> diagram block differs');
    }

    // 3. pages — deep-equal of page objects (jsonb semantics)
    const pd = diff(payload.pages, rebuilt.pages, '$.pages');
    if (pd) diffs.push(`pages: ${pd}`);

    // 4. process_structure — verbatim
    const psd = diff(payload.process_structure, rebuilt.process_structure, '$.process_structure');
    if (psd) diffs.push(`process_structure: ${psd}`);

    // 5. every other top-level scalar
    const sd = diff(
        omit(payload, ['built_page', 'pages', 'process_structure']),
        omit(rebuilt, ['built_page', 'pages', 'process_structure']),
        '$',
    );
    if (sd) diffs.push(`scalars: ${sd}`);

    return diffs;
}

// In-memory round-trip: decompose -> recompose from the produced file map -> compare.
function verifyRoundTrip(payload) {
    const { files } = decompose(payload);
    const read = (p) => {
        if (!(p in files)) throw new Error(`recompose read missing file: ${p}`);
        return files[p];
    };
    return comparePayload(payload, recompose(read));
}

export {
    decompose,
    recompose,
    comparePayload,
    verifyRoundTrip,
    MANIFEST_FILE,
    STRUCTURE_FILE,
    PROCESS_FILE,
    EDITABLE_SCALARS,
    toSlug,
};
