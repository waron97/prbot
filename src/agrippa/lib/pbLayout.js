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
// boundaryEvents have no ELK port concept here, so they are snapped onto their
// attached task's bottom border in a post-pass.

import ELK from 'elkjs/lib/elk.bundled.js';
import { CONTAINER, eachNode, SIZE } from './pbEdit.js';

const elk = new ELK();

const ROOT_OPTS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    'elk.spacing.nodeNode': '40',
    'elk.spacing.edgeNode': '20',
};
const CONTAINER_OPTS = { 'elk.padding': '[top=40.0,left=20.0,bottom=20.0,right=20.0]' };

function sizeOf(n) {
    if (SIZE[n.type]) return SIZE[n.type];
    if (n.layout) return [n.layout.width || 84, n.layout.height || 84];
    return [84, 84];
}

// structure node -> elk node (recursive for containers; container size omitted so
// ELK computes it from its children).
function toElk(n) {
    const en = { id: n.id };
    if (CONTAINER.has(n.type)) {
        en.layoutOptions = CONTAINER_OPTS;
        en.children = (n.nodes || []).map(toElk);
    } else {
        const [w, h] = sizeOf(n);
        en.width = w;
        en.height = h;
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

async function autoLayout(structure) {
    // ----- build the elk graph (all edges declared at root) -----
    const children = (structure.nodes || []).map(toElk);
    for (const a of structure.annotations || []) {
        children.push({ id: a.id, width: a.layout?.width || 100, height: a.layout?.height || 30 });
    }

    const happyEdges = computeHappyEdges(structure);
    const edges = [];
    eachNode(structure.nodes, null, (n) => {
        for (const e of n.edges || []) {
            const isHappy = happyEdges.has(e.id);
            edges.push({
                id: e.id,
                sources: [n.id],
                targets: [e.target],
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

    const graph = { id: 'root', layoutOptions: ROOT_OPTS, children, edges };
    const res = await elk.layout(graph);

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
            const wp = waypointsFor(e.id, lcaOffset(n.id, e.target));
            if (wp) e.waypoints = wp;
        }
    });

    // boundaryEvents: snap to the attached task's bottom border (no ELK port concept)
    eachNode(structure.nodes, null, (n) => {
        if (n.type !== 'boundaryEvent' || !n.attachedToRef) return;
        const t = pos[n.attachedToRef];
        if (t)
            n.layout = {
                x: round(t.x + t.width / 2 - 18),
                y: round(t.y + t.height - 18),
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

export { autoLayout };
