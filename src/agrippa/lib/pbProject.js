// Decompose a process-builder payload into editable files, and recompose it.
//
// Layout (see ai_tasks planning.md):
//   process.yaml      editable scalar overlay (identity + flags)
//   structure.yaml    the authoritative graph: nodes hold their own outgoing
//                     edges and (for subProcess) nested child nodes; each node
//                     carries its diagram layout {x,y,width,height}; each edge
//                     its waypoints. scriptTask bodies are referenced by file.
//   scripts/NNNN_*.js  one scriptTask body each, byte-exact
//   pages/<formKey>.yml  one userTask page object each
//   .agrippa-pb.json   manifest: all scalars verbatim, ns, full diagram, audit,
//                     id<->file maps
//
// The manifest carries every top-level scalar and the full diagram verbatim, so
// nothing is ever lost; process.yaml and the per-node layout/waypoints in
// structure.yaml *override* the manifest on recompose (so edits flow through).

import { parse as yamlParse, stringify as yamlStringify, Document, visit } from 'yaml';
import slugify from 'slugify';
import { parseProcess, buildProcess, compareProcess, compareDiagram, diff } from './pbModel.js';

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

// Container node types whose children nest under them in structure.yaml.
const CONTAINER_TAGS = new Set(['subProcess', 'transaction']);

// Type-specific node fields carried verbatim between the flat model and structure.yaml.
const NODE_FIELDS = [
    'attrs',
    'class',
    'fields',
    'formKey',
    'attachedToRef',
    'errorEventDefinition',
    'multiInstance',
    'documentation',
];

function toSlug(name) {
    return slugify(String(name ?? ''), { lower: true, strict: true }) || 'node';
}
function pad(n) {
    return String(n).padStart(4, '0');
}

// Render structure.yaml with layout/waypoints as compact inline (flow) collections.
function setFlowDeep(node) {
    if (!node || !node.items) return;
    node.flow = true;
    for (const it of node.items) {
        if (it?.items) setFlowDeep(it); // inner seq (e.g. a waypoint pair)
        if (it?.value?.items) setFlowDeep(it.value);
    }
}
function stringifyStructure(obj) {
    const doc = new Document(obj);
    visit(doc, {
        Pair(_, pair) {
            const key = pair.key?.value;
            if (key === 'layout' || key === 'waypoints') setFlowDeep(pair.value);
        },
    });
    return doc.toString({ lineWidth: 0 });
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

// ---------- geometry maps from a parsed diagram ----------

function geometryMaps(diagram) {
    const bounds = {};
    const waypoints = {};
    const expanded = {};
    if (diagram) {
        for (const s of diagram.shapes) {
            if (s.bounds) bounds[s.attrs.bpmnElement] = { ...s.bounds };
            if (s.attrs.isExpanded !== undefined) expanded[s.attrs.bpmnElement] = s.attrs.isExpanded;
        }
        for (const e of diagram.edges)
            if (e.waypoints?.length) waypoints[e.attrs.bpmnElement] = e.waypoints.map((w) => [w.x, w.y]);
    }
    return { bounds, waypoints, expanded };
}

// ---------- nested structure.yaml (decompose side) ----------

function structEdge(e, geo) {
    const o = { id: e.id, target: e.target };
    if (e.name !== undefined) o.name = e.name;
    if (e.condition !== undefined) o.condition = e.condition;
    if (e.conditionType !== undefined) o.conditionType = e.conditionType;
    if (e.documentation !== undefined) o.documentation = e.documentation;
    if (geo.waypoints[e.id]) o.waypoints = geo.waypoints[e.id];
    return o;
}

function structNode(n, model, scriptsMap, geo) {
    const out = { id: n.id, type: n.type };
    if (n.name !== undefined) out.name = n.name;
    for (const k of NODE_FIELDS) if (n[k] !== undefined) out[k] = n[k];
    if (n.type === 'scriptTask') out.script = scriptsMap[n.id];
    if (geo.bounds[n.id]) out.layout = geo.bounds[n.id];
    if (geo.expanded[n.id] !== undefined) out.expanded = geo.expanded[n.id];
    const outEdges = model.edges.filter((e) => e.source === n.id).map((e) => structEdge(e, geo));
    if (outEdges.length) out.edges = outEdges;
    if (CONTAINER_TAGS.has(n.type)) {
        const kids = nestNodes(model, n.id, scriptsMap, geo);
        if (kids.length) out.nodes = kids;
    }
    return out;
}

function nestNodes(model, parentId, scriptsMap, geo) {
    return model.nodes
        .filter((n) => (n.parent ?? null) === parentId)
        .map((n) => structNode(n, model, scriptsMap, geo));
}

// ---------- flatten structure.yaml back to model (recompose side) ----------

function flattenNodes(structNodes, parentId, model, read, geo) {
    for (const sn of structNodes || []) {
        const n = { id: sn.id, type: sn.type };
        if (sn.name !== undefined) n.name = sn.name;
        if (parentId) n.parent = parentId;
        for (const k of NODE_FIELDS) if (sn[k] !== undefined) n[k] = sn[k];
        if (sn.type === 'scriptTask') n.script = read(sn.script); // load body from file
        if (sn.layout) geo.bounds[sn.id] = sn.layout;
        if (sn.expanded !== undefined) geo.expanded[sn.id] = sn.expanded;
        model.nodes.push(n);

        for (const se of sn.edges || []) {
            const e = { id: se.id, source: sn.id, target: se.target };
            if (se.name !== undefined) e.name = se.name;
            if (se.condition !== undefined) e.condition = se.condition;
            if (se.conditionType !== undefined) e.conditionType = se.conditionType;
            if (se.documentation !== undefined) e.documentation = se.documentation;
            if (parentId) e.parent = parentId;
            if (se.waypoints) geo.waypoints[se.id] = se.waypoints;
            model.edges.push(e);
        }
        if (sn.nodes) flattenNodes(sn.nodes, sn.id, model, read, geo);
    }
}

// ---------- decompose: payload -> { files, manifest } ----------

function decompose(payload) {
    const { ns, model, diagram } = parseProcess(payload.built_page);
    const geo = geometryMaps(diagram);
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

    // structure.yaml — nested graph: edges under their source node, subProcess
    // children nested, layout/waypoints inline, scriptTask bodies by ref.
    // Annotations/associations carry their own geometry too, so the diagram is
    // fully regenerable from structure.yaml alone (the manifest is never read
    // back for the diagram).
    const structure = {
        process: model.process,
        errors: model.errors,
        nodes: nestNodes(model, null, scriptsMap, geo),
        annotations: model.annotations.map((a) => (geo.bounds[a.id] ? { ...a, layout: geo.bounds[a.id] } : a)),
        associations: model.associations.map((a) =>
            geo.waypoints[a.id] ? { ...a, waypoints: geo.waypoints[a.id] } : a,
        ),
    };
    files[STRUCTURE_FILE] = stringifyStructure(structure);

    // process.yaml — editable scalar overlay.
    files[PROCESS_FILE] = yamlStringify(pick(payload, EDITABLE_SCALARS), { lineWidth: 0 });

    // manifest — scalars/audit/ns + id<->file maps. The diagram is NOT stored:
    // it is regenerated from structure.yaml geometry on recompose.
    const manifest = {
        guid: payload.guid,
        document_id: payload.document_id,
        process_name: payload.process_name,
        scalars: omit(payload, ['built_page', 'pages', 'process_structure']),
        process_structure: payload.process_structure,
        ns,
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

    const model = {
        process: structure.process,
        errors: structure.errors || [],
        nodes: [],
        edges: [],
        annotations: structure.annotations || [],
        associations: structure.associations || [],
    };
    const geo = { bounds: {}, waypoints: {}, expanded: {} };
    flattenNodes(structure.nodes, null, model, read, geo);
    // annotation/association geometry (top-level lists carry it inline)
    for (const a of model.annotations) if (a.layout) geo.bounds[a.id] = a.layout;
    for (const a of model.associations) if (a.waypoints) geo.waypoints[a.id] = a.waypoints;

    const built_page = buildProcess({ ns: manifest.ns, model, geo });

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

    // 2. diagram geometry — structural (drawing-order-insensitive, waypoints ordered)
    const diaDiff = compareDiagram(payload.built_page, rebuilt.built_page);
    if (diaDiff) diffs.push(`built_page <bpmndi>: ${diaDiff}`);

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
