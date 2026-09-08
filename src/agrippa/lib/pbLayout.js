// Auto-layout for a decomposed process-builder graph, via elkjs.
//
// `autoLayout(structure)` rewrites every node's `layout {x,y,width,height}` and
// every edge's `waypoints` (plus annotations/associations) in place, producing a
// left→right (start-left, end-right) layered diagram. The decomposed diagram is
// regenerated from this geometry on recompose, so formatting here is all it takes.
//
// elkjs handles subProcess/transaction natively as compound nodes: children are
// laid out and the container is auto-sized. Two coordinate subtleties are handled:
//   1. Node coords ELK returns are parent-relative → accumulated to absolute (BPMN
//      bounds are absolute regardless of nesting).
//   2. Edge section coords are relative to the lowest common ancestor (LCA)
//      container of the edge's endpoints → offset by that container's absolute
//      origin (root → 0,0). See the LCA computation below.
// boundaryEvents are excluded from the ELK node graph and modelled as ports
// on their attachedToRef node, which makes ELK route their outgoing edge as a
// real hierarchy-crossing flow. ELK does NOT honour any port side/position for
// such edges (it exits the border facing the target) and the port rectangle it
// reports often disagrees with where the edge is actually drawn — so the
// boundary glyph is snapped onto the edge's start point afterwards, not the
// reported port.

import ELK from 'elkjs/lib/elk.bundled.js';
import { CONTAINER, eachNode, SIZE } from './pbEdit.js';

const elk = new ELK();

const ROOT_OPTS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    'elk.spacing.nodeNode': '80',
    'elk.spacing.edgeNode': '20',
    'elk.spacing.edgeEdge': '20',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
    'elk.layered.spacing.edgeNodeBetweenLayers': '20',
};
const CONTAINER_OPTS = {
    'elk.padding': '[top=50.0,left=30.0,bottom=50.0,right=30.0]',
    'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    'elk.spacing.nodeNode': '80',
    'elk.spacing.edgeNode': '20',
    'elk.layered.spacing.edgeNodeBetweenLayers': '20',
};

function sizeOf(n) {
    if (SIZE[n.type]) return SIZE[n.type];
    if (n.layout) return [n.layout.width || 84, n.layout.height || 84];
    return [84, 84];
}

// structure node -> elk node (recursive for containers; container size omitted so
// ELK computes it from its children). boundaryEvents are skipped — they appear as
// ports on their attachedToRef node instead (beByRef collected by the caller).
function toElk(n, beByRef) {
    if (n.type === 'boundaryEvent') return null;
    const en = { id: n.id };
    if (CONTAINER.has(n.type)) {
        en.layoutOptions = CONTAINER_OPTS;
        en.children = (n.nodes || []).map((c) => toElk(c, beByRef)).filter(Boolean);
    } else {
        const [w, h] = sizeOf(n);
        en.width = w;
        en.height = h;
    }
    const bes = beByRef?.[n.id];
    if (bes?.length) {
        // The port exists only so ELK reserves the edge and routes it as a real
        // hierarchy-crossing flow. ELK ignores any port side/position constraint
        // for these edges — it always exits the border facing the target — so we
        // don't bother setting one; the boundary glyph is later snapped onto the
        // edge's actual start point instead (see below).
        en.ports = bes.map((be) => ({ id: `__port_${be.id}` }));
    }
    return en;
}

function round(v) {
    return Math.round(v);
}

// ----- happy-flow edges -----
// The happy flow is every edge crossed walking from a scope's startEvent to
// any dead end, taking ONLY the `default` branch at an exclusiveGateway and
// ALL outgoing edges at any other node (forks like parallel gateways are not
// a "choice", so every branch counts as happy). Computed per scope (root,
// then recursively inside each subProcess/transaction's own `nodes`) since a
// sequenceFlow only ever connects siblings within the same container.
function happyEdgesInScope(nodes, acc) {
    const byId = new Map((nodes || []).map((n) => [n.id, n]));
    const visited = new Set();
    const visit = (n) => {
        if (visited.has(n.id)) return;
        visited.add(n.id);
        const edges = n.edges || [];
        if (n.type === 'exclusiveGateway' && edges.length > 1) {
            const def = n.attrs?.default;
            const e = edges.find((e) => e.id === def) || edges[0];
            acc.add(e.id);
            const next = byId.get(e.target);
            if (next) visit(next);
        } else {
            for (const e of edges) {
                acc.add(e.id);
                const next = byId.get(e.target);
                if (next) visit(next);
            }
        }
    };
    for (const n of nodes || []) {
        if (n.type === 'startEvent') visit(n);
        if (n.nodes) happyEdgesInScope(n.nodes, acc);
    }
}

function computeHappyEdges(structure) {
    const acc = new Set();
    happyEdgesInScope(structure.nodes, acc);
    return acc;
}

// Explicit happy path: the edges joining an ordered list of node ids, used to
// override the `default`-following heuristic above. The heuristic is a good
// guess but has no escape hatch — when a gateway's `default` legitimately
// points into a retry loop (a polling/wait pattern), it prioritises the loop
// over the real spine and the only previous workaround was to rewrite which
// flow is `default` in the BPMN itself, i.e. changing process semantics to
// steer a layout heuristic. This steers it directly instead.
function happyEdgesFromPath(structure, path) {
    const byId = new Map();
    eachNode(structure.nodes, null, (n) => byId.set(n.id, n));
    const acc = new Set();
    for (let i = 1; i < path.length; i++) {
        const from = byId.get(path[i - 1]);
        if (!from) throw new Error(`--happy: no such node: ${path[i - 1]}`);
        if (!byId.has(path[i])) throw new Error(`--happy: no such node: ${path[i]}`);
        const edge = (from.edges || []).find((e) => e.target === path[i]);
        if (!edge)
            throw new Error(
                `--happy: no flow ${path[i - 1]} → ${path[i]} — the path is not connected.`
            );
        acc.add(edge.id);
    }
    return acc;
}

// ELK silently ignores an option key it doesn't recognise, so a typo in --elk
// would otherwise look like a successful experiment that changed nothing. The
// engine can list what it accepts, so check against that and suggest the near
// misses (ELK's own docs use the short `elk.*` spelling; the engine reports the
// fully-qualified `org.eclipse.elk.*` one, and both are accepted here).
async function validateElkOptions(elkOptions) {
    const keys = Object.keys(elkOptions || {});
    if (!keys.length) return;

    const known = await elk.knownLayoutOptions();
    const ids = new Set(known.map((o) => o.id).filter(Boolean));
    const unknown = keys.filter((k) => !ids.has(k) && !ids.has(`org.eclipse.${k}`));
    if (!unknown.length) return;

    const leaf = (k) => k.split('.').pop().toLowerCase();
    const lines = unknown.map((k) => {
        const near = [...ids]
            .filter((i) => leaf(i) === leaf(k))
            .map((i) => i.replace(/^org\.eclipse\./, ''));
        return `  ${k}${near.length ? ` - did you mean ${near.join(' or ')}?` : ''}`;
    });
    throw new Error(
        `unknown --elk option(s):\n${lines.join('\n')}\n` +
            'Names are case-sensitive; see https://eclipse.dev/elk/reference/options.html'
    );
}

// `opts.elkOptions` are raw ELK layout options merged over ROOT_OPTS, so an
// experiment ("does feedbackEdges help this graph?") is a flag rather than an
// edit to this file and a `git checkout` to undo. `opts.happy` is an ordered
// node-id path that replaces the happy-flow heuristic; `opts.noHappy` disables
// the priority boost entirely.
async function autoLayout(structure, opts = {}) {
    await validateElkOptions(opts.elkOptions);

    // ----- build the elk graph (all edges declared at root) -----
    // boundaryEvents are removed from the node set and surfaced as ports on
    // their attachedToRef node, so ELK routes their outgoing edges from the
    // correct border position natively.
    const beByRef = {};
    eachNode(structure.nodes, null, (n) => {
        if (n.type === 'boundaryEvent' && n.attachedToRef)
            (beByRef[n.attachedToRef] ||= []).push(n);
    });

    const children = (structure.nodes || []).map((n) => toElk(n, beByRef)).filter(Boolean);
    for (const a of structure.annotations || []) {
        children.push({ id: a.id, width: a.layout?.width || 100, height: a.layout?.height || 30 });
    }

    const happyEdges = opts.noHappy
        ? new Set()
        : opts.happy?.length
          ? happyEdgesFromPath(structure, opts.happy)
          : computeHappyEdges(structure);
    const edges = [];
    eachNode(structure.nodes, null, (n) => {
        for (const e of n.edges || []) {
            const isHappy = happyEdges.has(e.id);
            let source = n.id;
            let sourcePort;
            if (n.type === 'boundaryEvent' && n.attachedToRef) {
                source = n.attachedToRef;
                sourcePort = `__port_${n.id}`;
            }
            edges.push({
                id: e.id,
                sources: [source],
                targets: [e.target],
                sourcePort,
                labels: e.name
                    ? [
                          {
                              id: `${e.id}__lbl`,
                              text: e.name,
                              width: Math.min(e.name.length * 6, 140),
                              height: 14,
                          },
                      ]
                    : [],
                layoutOptions: {
                    'elk.layered.priority.straightness': isHappy ? '10' : 1,
                    'elk.layered.priority.shortness': isHappy ? '10' : 1,
                    'elk.layered.priority.direction': isHappy ? '10' : 1,
                },
            });
        }
    });
    for (const a of structure.associations || []) {
        edges.push({ id: a.id, sources: [a.sourceRef], targets: [a.targetRef] });
    }

    const graph = {
        id: 'root',
        layoutOptions: { ...ROOT_OPTS, ...(opts.elkOptions || {}) },
        children,
        edges,
    };
    // Some ELK options interact badly enough to throw or hang. When the caller
    // supplied any, say so — a raw elkjs stack trace gives no hint that the
    // flag they just passed is the cause.
    let res;
    try {
        res = await elk.layout(graph);
    } catch (e) {
        const passed = Object.keys(opts.elkOptions || {});
        if (!passed.length) throw e;
        throw new Error(
            `elk failed with your --elk options (${passed.join(', ')}): ${e.message}\n` +
                'Drop or correct them and retry; option names are case-sensitive ' +
                '(see https://eclipse.dev/elk/reference/options.html).'
        );
    }

    // ----- node absolute positions (accumulate parent-relative coords) -----
    const pos = {};
    const accumulate = (node, ox, oy) => {
        for (const c of node.children || []) {
            const ax = ox + (c.x || 0);
            const ay = oy + (c.y || 0);
            pos[c.id] = { x: ax, y: ay, width: c.width, height: c.height };
            if (c.children) accumulate(c, ax, ay);
        }
    };
    accumulate(res, 0, 0);

    // ----- port positions (boundaryEvent ports on their attachedToRef node) -----
    const portPos = {};
    const accumulatePorts = (node, ox, oy) => {
        for (const p of node.ports || []) {
            portPos[p.id] = {
                x: ox + (p.x || 0),
                y: oy + (p.y || 0),
                width: p.width || 0,
                height: p.height || 0,
            };
        }
        for (const c of node.children || []) {
            accumulatePorts(c, ox + (c.x || 0), oy + (c.y || 0));
        }
    };
    accumulatePorts(res, 0, 0);

    // ----- container path per node (for edge LCA offset) -----
    const pathOf = {};
    const walkPaths = (nodes, stack) => {
        for (const n of nodes || []) {
            pathOf[n.id] = stack;
            if (n.nodes) walkPaths(n.nodes, [...stack, n.id]);
        }
    };
    walkPaths(structure.nodes, []);
    for (const a of structure.annotations || []) pathOf[a.id] = pathOf[a.id] || [];

    const lcaOffset = (a, b) => {
        const pa = pathOf[a] || [];
        const pb = pathOf[b] || [];
        let i = 0;
        while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++;
        const lca = i > 0 ? pa[i - 1] : null;
        return lca && pos[lca] ? pos[lca] : { x: 0, y: 0 };
    };

    // ----- collect returned elk edges by id (coords are LCA-relative) -----
    const elkEdges = {};
    const collectEdges = (node) => {
        for (const e of node.edges || []) elkEdges[e.id] = e;
        for (const c of node.children || []) collectEdges(c);
    };
    collectEdges(res);

    const waypointsFor = (edgeId, off) => {
        const sec = elkEdges[edgeId]?.sections?.[0];
        if (!sec) return null;
        const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint];
        return pts.map((p) => [round(p.x + off.x), round(p.y + off.y)]);
    };

    // ----- write geometry back into the structure -----
    eachNode(structure.nodes, null, (n) => {
        const p = pos[n.id];
        if (p)
            n.layout = {
                x: round(p.x),
                y: round(p.y),
                width: round(p.width),
                height: round(p.height),
            };
        for (const e of n.edges || []) {
            const off = lcaOffset(n.id, e.target);
            const wp = waypointsFor(e.id, off);
            if (wp) e.waypoints = wp;
            if (e.name) {
                const lbl = elkEdges[e.id]?.labels?.[0];
                if (lbl) {
                    e.labelPos = {
                        x: round(lbl.x + off.x),
                        y: round(lbl.y + off.y),
                        width: round(lbl.width),
                        height: round(lbl.height),
                    };
                }
            }
        }
    });

    // boundaryEvents: positioned from the first waypoint of their outgoing edge.
    // With free port constraints, elkjs reports the port rect on one border but
    // routes the edge from another, so the reported port position and the actual
    // edge origin disagree (the glyph would detach from its own arrow). The edge
    // section is the source of truth — its startPoint sits exactly on the
    // attachedToRef border where the flow leaves — so we center the 36×36 glyph
    // there. Fall back to the port rect only for a boundary event with no edge.
    eachNode(structure.nodes, null, (n) => {
        if (n.type !== 'boundaryEvent' || !n.attachedToRef) return;
        const wp0 = n.edges?.find((e) => e.waypoints?.length)?.waypoints[0];
        const center = wp0 ? { x: wp0[0], y: wp0[1] } : portPos[`__port_${n.id}`];
        if (center)
            n.layout = {
                x: round(center.x - 18),
                y: round(center.y - 18),
                width: 36,
                height: 36,
            };
    });

    for (const a of structure.annotations || []) {
        const p = pos[a.id];
        if (p)
            a.layout = {
                x: round(p.x),
                y: round(p.y),
                width: round(p.width),
                height: round(p.height),
            };
    }
    for (const a of structure.associations || []) {
        const wp = waypointsFor(a.id, lcaOffset(a.sourceRef, a.targetRef));
        if (wp) a.waypoints = wp;
    }

    return structure;
}

export { autoLayout, computeHappyEdges, validateElkOptions };
