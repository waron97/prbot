// Structural graph helpers for a decomposed process-builder project.
//
// These operate on the parsed structure.yaml object (the nested graph: nodes
// hold their own outgoing `edges` and, for containers, nested `nodes`). They
// cover the ops where hand-editing the multi-thousand-line YAML traps an agent:
// BPMN id generation, dangling-edge cleanup on remove, subProcess nesting, and
// multi-file scaffolding (script/page/manifest). Content edits (rename, change a
// condition, edit a script body) stay raw-YAML — a helper there adds nothing.
//
// Functions mutate `structure`/`manifest` in place and return any file
// side-effects (`writes`/`deletes`) plus a `result` for the CLI to report.
// Geometry is intentionally stubbed (correct size, placeholder position) — the
// agent runs `pb format` to finalize layout. No IO happens here.

import { stringify as yamlStringify } from 'yaml';
import { pad, toSlug } from './pbProject.js';
import { SCRIPT_TEMPLATE } from './pbScriptTemplate.js';

// Fixed element sizes (measured across all fixtures). Containers are sized by
// the layout engine; we seed a small default so a stubbed clone stays valid.
const SIZE = {
    startEvent: [36, 36],
    endEvent: [36, 36],
    boundaryEvent: [36, 36],
    exclusiveGateway: [50, 50],
    scriptTask: [84, 84],
    serviceTask: [84, 84],
    userTask: [84, 84],
    subProcess: [350, 200],
    transaction: [350, 200],
};

// BPMN id prefixes by node type (mirrors the upstream naming convention).
const PREFIX = {
    startEvent: 'StartEvent',
    endEvent: 'EndEvent',
    boundaryEvent: 'BoundaryEvent',
    exclusiveGateway: 'ExclusiveGateway',
    scriptTask: 'ScriptTask',
    serviceTask: 'ServiceTask',
    userTask: 'UserTask',
    subProcess: 'SubProcess',
    transaction: 'Transaction',
};

const CONTAINER = new Set(['subProcess', 'transaction']);

// Default attrs injected at node creation so the editor accepts them without manual edits.
const DEFAULT_ATTRS = {
    scriptTask: {
        scriptFormat: 'javascript',
        'activiti:async': 'false',
        'activiti:exclusive': 'false',
        'activiti:autoStoreVariables': 'false',
    },
    serviceTask: {
        'activiti:async': 'false',
        'activiti:exclusive': 'false',
    },
};

// Depth-first visit of every node in the nested graph, with its parent node.
function eachNode(nodes, parent, fn) {
    for (const n of nodes || []) {
        fn(n, parent);
        if (n.nodes) eachNode(n.nodes, n, fn);
    }
}

// All ids in use (nodes, edges, annotations, associations) — for collision-free gen.
function collectIds(structure) {
    const ids = new Set();
    eachNode(structure.nodes, null, (n) => {
        ids.add(n.id);
        for (const e of n.edges || []) ids.add(e.id);
    });
    for (const a of structure.annotations || []) ids.add(a.id);
    for (const a of structure.associations || []) ids.add(a.id);
    return ids;
}

function rand() {
    return Math.random().toString(36).slice(2, 9).padEnd(7, '0');
}

function genId(structure, prefix) {
    const ids = collectIds(structure);
    let id;
    do {
        id = `${prefix}_${rand()}`;
    } while (ids.has(id));
    return id;
}

// Locate a node anywhere in the tree → { node, list (its containing array), parent }.
function findNode(structure, id) {
    let found = null;
    const search = (nodes, parent) => {
        for (const n of nodes || []) {
            if (n.id === id) {
                found = { node: n, list: nodes, parent };
                return true;
            }
            if (n.nodes && search(n.nodes, n)) return true;
        }
        return false;
    };
    search(structure.nodes, null);
    return found;
}

// Center point of a node from its (possibly stub) layout — for placeholder waypoints.
function centerOf(n) {
    const l = n.layout || { x: 0, y: 0, width: 0, height: 0 };
    return [Math.round(l.x + (l.width || 0) / 2), Math.round(l.y + (l.height || 0) / 2)];
}

// Next script sequence number (max existing ×10 step, default 10).
function nextScriptSeq(existingScriptFiles) {
    let max = 0;
    for (const f of existingScriptFiles || []) {
        const m = /(?:^|\/)(\d{4})_/.exec(f);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 10;
}

// ---------- add ----------

// Add a node. For scriptTask, scaffolds a templated script file and refs it. For
// userTask, scaffolds a minimal page file + a manifest page entry (guid=null →
// push will create it upstream). Container nodes start empty + expanded.
function addNode(structure, manifest, opts, ctx = {}) {
    const { type, name, parentId } = opts;
    if (!PREFIX[type]) throw new Error(`Unknown node type: ${type}`);

    const id = genId(structure, PREFIX[type]);
    const [w, h] = SIZE[type];
    const node = { id, type };
    if (name !== undefined) node.name = name;
    node.layout = { x: 0, y: 0, width: w, height: h };

    const writes = {};

    if (type === 'scriptTask') {
        const seq = nextScriptSeq(ctx.existingScripts);
        const file = `scripts/${pad(seq)}_${toSlug(name || id)}.js`;
        writes[file] = SCRIPT_TEMPLATE;
        node.script = file;
    } else if (type === 'userTask') {
        const formKey = toSlug(name || id);
        node.formKey = formKey;
        const file = `pages/${formKey}.yml`;
        const pageObj = {
            _id: { stepkey: id, processkey: ctx.documentId ?? manifest?.document_id ?? null },
            columns: 1,
            entities: [],
            language: '',
            page_name: '',
            page_builder: [],
        };
        writes[file] = yamlStringify(pageObj, { lineWidth: 0 });
        manifest.pages = manifest.pages || {};
        manifest.pages[id] = {
            file,
            wrapper: {
                name: id,
                guid: null,
                process_guid: manifest.guid ?? null,
                system_record: false,
                owner_group: null,
            },
        };
    } else if (CONTAINER.has(type)) {
        node.expanded = 'true';
        node.nodes = [];
    }

    if (DEFAULT_ATTRS[type]) node.attrs = { ...DEFAULT_ATTRS[type] };

    if (parentId) {
        const f = findNode(structure, parentId);
        if (!f) throw new Error(`parent not found: ${parentId}`);
        if (!CONTAINER.has(f.node.type))
            throw new Error(`parent ${parentId} is not a container (subProcess/transaction)`);
        f.node.nodes = f.node.nodes || [];
        f.node.nodes.push(node);
    } else {
        structure.nodes.push(node);
    }

    return { writes, deletes: [], result: { id, type, file: writes && Object.keys(writes)[0] } };
}

// Add a node spliced between two already-connected nodes: there must be exactly
// one sequenceFlow `from` → `to` already (none, or more than one, is an error —
// ambiguous or nothing to splice). That edge (id, name, condition, default-flag
// reference — all keyed by edge id) is kept and retargeted onto the new node; a
// second plain edge runs new-node → `to`. `from`/`to` must share the same
// container — boundary-crossing flows aren't auto-spliced.
function addNodeBetween(structure, manifest, opts, ctx = {}) {
    const { from, to, type, name } = opts;
    if (!PREFIX[type]) throw new Error(`Unknown node type: ${type}`);

    const sf = findNode(structure, from);
    if (!sf) throw new Error(`source node not found: ${from}`);
    const st = findNode(structure, to);
    if (!st) throw new Error(`target node not found: ${to}`);

    const sfParentId = sf.parent ? sf.parent.id : null;
    const stParentId = st.parent ? st.parent.id : null;
    if (sfParentId !== stParentId) {
        throw new Error(
            `${from} and ${to} are in different containers (boundary-crossing flow) — ` +
                'insert not supported automatically; use `pb add` + `pb connect`/`pb disconnect` manually.'
        );
    }

    const candidates = (sf.node.edges || []).filter((e) => e.target === to);
    if (candidates.length !== 1) {
        throw new Error(
            candidates.length === 0
                ? `no edge ${from} → ${to}; nothing to insert between.`
                : `${candidates.length} edges ${from} → ${to} (${candidates.map((e) => e.id).join(', ')}); ` +
                      'must be exactly one to insert between.'
        );
    }
    const edge = candidates[0];

    const { writes, result } = addNode(
        structure,
        manifest,
        { type, name, parentId: sfParentId || undefined },
        ctx
    );
    const newNode = findNode(structure, result.id).node;

    edge.target = result.id;
    edge.waypoints = [centerOf(sf.node), centerOf(newNode)];

    const id2 = genId(structure, 'SequenceFlow');
    newNode.edges = newNode.edges || [];
    newNode.edges.push({ id: id2, target: to, waypoints: [centerOf(newNode), centerOf(st.node)] });

    const warnings =
        sf.node.type === 'exclusiveGateway'
            ? lintGateways(structure).filter((w) => w.startsWith(from))
            : [];

    return {
        writes,
        deletes: [],
        result: {
            id: result.id,
            type,
            file: result.file,
            edgeId: edge.id,
            newEdgeId: id2,
            warnings,
        },
    };
}

// ---------- remove ----------

// Remove a node (and, recursively, its container children). Drops the node's own
// outgoing edges (they nest under it) AND every edge elsewhere targeting it or a
// descendant, plus any associations referencing them. Deletes the script/page
// files and manifest page entries for the removed userTask/scriptTask nodes.
function removeNode(structure, manifest, { id }) {
    const f = findNode(structure, id);
    if (!f) throw new Error(`node not found: ${id}`);

    const victims = [];
    const collect = (n) => {
        victims.push(n);
        for (const c of n.nodes || []) collect(c);
    };
    collect(f.node);
    const victimIds = new Set(victims.map((n) => n.id));

    const deletes = [];
    for (const n of victims) {
        if (n.type === 'scriptTask' && n.script) deletes.push(n.script);
        if (n.type === 'userTask') {
            const info = manifest.pages?.[n.id];
            if (info?.file) deletes.push(info.file);
            if (manifest.pages) delete manifest.pages[n.id];
        }
    }

    // unlink the node from its containing list
    f.list.splice(f.list.indexOf(f.node), 1);

    // drop dangling edges (inbound from outside the removed subtree)
    let removedEdges = 0;
    eachNode(structure.nodes, null, (n) => {
        if (!n.edges) return;
        const before = n.edges.length;
        n.edges = n.edges.filter((e) => !victimIds.has(e.target));
        removedEdges += before - n.edges.length;
    });
    if (structure.associations) {
        structure.associations = structure.associations.filter(
            (a) => !victimIds.has(a.sourceRef) && !victimIds.has(a.targetRef)
        );
    }

    return { writes: {}, deletes, result: { removed: [...victimIds], removedEdges } };
}

// ---------- connect / disconnect ----------

// Add a sequenceFlow from `from` to `to`. Stub straight-line waypoints (center→
// center) keep the project recompose-valid until `pb format` reroutes.
//
// exclusiveGateway rule (enforced by Activiti): when a gateway has >1 outgoing
// flow, exactly one must be the `default` and every other must carry a condition
// expression. `--default` sets the source gateway's default to the new edge;
// otherwise a non-default flow should be given a `--condition`. Violations are
// returned as `result.warnings` (non-blocking) so the caller can surface them.
function connect(structure, { from, to, name, condition, conditionType, makeDefault }) {
    const sf = findNode(structure, from);
    if (!sf) throw new Error(`source node not found: ${from}`);
    const st = findNode(structure, to);
    if (!st) throw new Error(`target node not found: ${to}`);

    const id = genId(structure, 'SequenceFlow');
    const edge = { id, target: to };
    if (name !== undefined) edge.name = name;
    if (condition !== undefined) {
        edge.condition = condition;
        edge.conditionType = conditionType || 'tFormalExpression';
    }
    edge.waypoints = [centerOf(sf.node), centerOf(st.node)];

    sf.node.edges = sf.node.edges || [];
    sf.node.edges.push(edge);

    const warnings = [];
    if (makeDefault) {
        if (sf.node.type !== 'exclusiveGateway') {
            warnings.push(
                `--default only applies to exclusiveGateway; ${from} is ${sf.node.type}.`
            );
        } else {
            const prev = sf.node.attrs?.default;
            sf.node.attrs = sf.node.attrs || {};
            sf.node.attrs.default = id;
            if (prev && prev !== id)
                warnings.push(`replaced previous default flow ${prev} on ${from}.`);
        }
    }
    // Re-check all structural invariants after the edit, scoped to affected nodes.
    const allIssues = lintAll(structure);
    warnings.push(...allIssues.filter((w) => w.startsWith(from) || w.startsWith(to)));

    return { writes: {}, deletes: [], result: { id, from, to, warnings } };
}

// Mark an existing outgoing flow as the source gateway's default — by edge id,
// or by --from/--to pair. The flow must already exist (use `pb connect` to add a
// new one); this only flips the default flag, so the agent no longer has to
// delete and re-add a connection just to change which one is default. The owner
// must be an exclusiveGateway. Returns the previous default (if any) and a fresh
// gateway lint as non-blocking warnings.
function setDefault(structure, { id, from, to }) {
    let owner = null;
    let edge = null;
    eachNode(structure.nodes, null, (n) => {
        if (owner || !n.edges) return;
        const e = id
            ? n.edges.find((x) => x.id === id)
            : n.id === from && n.edges.find((x) => x.target === to);
        if (e) {
            owner = n;
            edge = e;
        }
    });
    if (!edge) throw new Error(id ? `edge not found: ${id}` : `no edge from ${from} to ${to}`);
    if (owner.type !== 'exclusiveGateway')
        throw new Error(
            `--default only applies to exclusiveGateway; ${owner.id} is ${owner.type}.`
        );

    const prev = owner.attrs?.default;
    owner.attrs = owner.attrs || {};
    owner.attrs.default = edge.id;

    const warnings = lintGateways(structure).filter((w) => w.startsWith(owner.id));
    return {
        writes: {},
        deletes: [],
        result: { id: edge.id, from: owner.id, to: edge.target, prev, warnings },
    };
}

// Flag exclusiveGateways that violate the default/condition rule: a gateway with
// >1 outgoing flow needs exactly one default, and every non-default flow needs a
// condition. Returns human-readable issue strings (empty = all good).
function lintGateways(structure) {
    const issues = [];
    eachNode(structure.nodes, null, (n) => {
        if (n.type !== 'exclusiveGateway') return;
        const outs = n.edges || [];
        if (outs.length < 2) return;
        const def = n.attrs?.default;
        const hasDefault = def && outs.some((e) => e.id === def);
        if (!hasDefault) {
            issues.push(
                `${n.id} (${n.name || 'gateway'}): ${outs.length} outgoing flows but no default — mark one with --default.`
            );
        }
        for (const e of outs) {
            if (e.id === def) continue;
            if (e.condition === undefined) {
                issues.push(
                    `${n.id} → ${e.target} (${e.id}): non-default flow without a condition expression.`
                );
            }
        }
    });
    return issues;
}

// Flag non-default outgoing edges that are missing a name when a node has 2+
// outgoing flows. In Activiti diagrams these labels are mandatory so operators
// can distinguish branches at runtime.
function lintEdgeNames(structure) {
    const issues = [];
    eachNode(structure.nodes, null, (n) => {
        const outs = n.edges || [];
        if (outs.length < 2) return;
        const def = n.attrs?.default;
        for (const e of outs) {
            if (e.id === def) continue;
            if (!e.name) {
                issues.push(
                    `${n.id} → ${e.target} (${e.id}): non-default flow has no name.`
                );
            }
        }
    });
    return issues;
}

// Flag incoming-edge violations:
// - Only exclusiveGateway may have >1 incoming flows.
// - An exclusiveGateway may not have both >1 incoming AND >1 outgoing (pick one
//   direction for merging or splitting, not both at once).
function lintIncomingEdges(structure) {
    const inCount = {};
    const outCount = {};
    eachNode(structure.nodes, null, (n) => {
        for (const e of n.edges || []) {
            inCount[e.target] = (inCount[e.target] || 0) + 1;
            outCount[n.id] = (outCount[n.id] || 0) + 1;
        }
    });

    const issues = [];
    eachNode(structure.nodes, null, (n) => {
        const inc = inCount[n.id] || 0;
        const out = outCount[n.id] || 0;
        if (inc > 1 && n.type !== 'exclusiveGateway') {
            issues.push(
                `${n.id} (${n.name || n.type}): only exclusiveGateway may have multiple incoming flows (has ${inc}).`
            );
        }
        if (n.type === 'exclusiveGateway' && inc > 1 && out > 1) {
            issues.push(
                `${n.id} (${n.name || 'gateway'}): exclusiveGateway may not have both multiple incoming (${inc}) and multiple outgoing (${out}) flows.`
            );
        }
    });
    return issues;
}

// Run all lint rules and return combined issues.
function lintAll(structure) {
    return [...lintGateways(structure), ...lintEdgeNames(structure), ...lintIncomingEdges(structure)];
}

// Remove an edge by id, or by --from/--to pair.
function disconnect(structure, { id, from, to }) {
    let removed = 0;
    let removedId = null;
    eachNode(structure.nodes, null, (n) => {
        if (!n.edges) return;
        const before = n.edges.length;
        n.edges = n.edges.filter((e) => {
            const match = id ? e.id === id : n.id === from && e.target === to;
            if (match) removedId = e.id;
            return !match;
        });
        removed += before - n.edges.length;
    });
    if (!removed) throw new Error(id ? `edge not found: ${id}` : `no edge from ${from} to ${to}`);
    return { writes: {}, deletes: [], result: { removed, id: removedId } };
}

// ---------- list ----------

// Flat rows for `pb ls` so an agent can discover ids/targets without reading YAML.
function listGraph(structure) {
    const rows = [];
    eachNode(structure.nodes, null, (n, parent) => {
        const def = n.attrs?.default;
        rows.push({
            id: n.id,
            type: n.type,
            name: n.name ?? '',
            parent: parent ? parent.id : null,
            edges: (n.edges || []).map((e) => ({
                id: e.id,
                target: e.target,
                name: e.name,
                condition: e.condition,
                isDefault: def === e.id,
            })),
        });
    });
    return rows;
}

export {
    SIZE,
    PREFIX,
    CONTAINER,
    eachNode,
    findNode,
    genId,
    addNode,
    addNodeBetween,
    removeNode,
    connect,
    disconnect,
    setDefault,
    listGraph,
    lintGateways,
    lintEdgeNames,
    lintIncomingEdges,
    lintAll,
};
