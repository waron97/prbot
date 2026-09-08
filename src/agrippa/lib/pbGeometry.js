// Geometry primitives for a decomposed process-builder diagram.
//
// Everything that reasons in coordinates lives here; the layout commands built
// on top speak only in node ids, lanes and gaps. Coordinates in structure.yaml
// are absolute (BPMN bounds are absolute regardless of nesting), so there is no
// container-relative offset math here — that exists only in pbLayout.js, to
// translate what ELK hands back.
//
// The two inference helpers are what make the layout commands coordinate-free:
// a hand-tuned diagram already encodes its own row structure and its own
// spacing in the numbers, so both are read back out of the geometry rather than
// declared anywhere. Nothing is persisted beyond `layout`, `waypoints` and
// `labelPos` — exactly the fields `pb format` already writes. A lane is a
// derived view that exists for the duration of one command and is then
// forgotten; it is never a key in structure.yaml (recompose would drop it, and
// it would rot the moment a human moved a node in the real editor).
//
// The router's shape is not invented: "leave the source vertically, travel
// along the target's row, enter the side of the target that faces the source"
// reproduces every single edge of the hand-tuned fixture in
// ai_tasks/2026-09-08-pb-manual-layout-commands/fixtures/, which is what the
// house style looks like when a human draws it.

import { CONTAINER, eachNode } from './pbEdit.js';

// Two centres within this many px count as the same row/column — the same
// tolerance that recovers 4 lanes on the fixture and 5 on ml_client_contact.
const ALIGN_TOL = 12;
// Fallback horizontal gap when a project is too sparse to infer its own.
// 60px is the modal edge-to-edge gap across the real corpus.
const DEFAULT_GAP = 60;
// A gap wider than this is a deliberate hole (a loop-back run, a detached
// cluster), not the diagram's natural spacing — excluded from gap inference.
const MAX_INFERABLE_GAP = 200;
// Flow labels sit this far above the point where the edge settles.
const LABEL_OFFSET = 15;

function boxOf(n) {
    const l = n.layout || { x: 0, y: 0, width: 0, height: 0 };
    const w = l.width || 0;
    const h = l.height || 0;
    return {
        x: l.x,
        y: l.y,
        width: w,
        height: h,
        left: l.x,
        right: l.x + w,
        top: l.y,
        bottom: l.y + h,
        cx: Math.round(l.x + w / 2),
        cy: Math.round(l.y + h / 2),
    };
}

function clamp(v, lo, hi) {
    return hi < lo ? v : Math.min(Math.max(v, lo), hi);
}

// Root-scope, positioned, non-container nodes — the ones the layout commands
// own. Container children are left to `pb format` (see the scope guard in
// pbLayoutOps.js); containers themselves are sized by their contents.
function layoutNodes(structure) {
    return (structure.nodes || []).filter((n) => n.layout && !CONTAINER.has(n.type));
}

function byX(a, b) {
    return boxOf(a).x - boxOf(b).x;
}

// The lane's canonical centreline: the centre-y most of its members actually
// sit on (ties → topmost), not the mean — a row of tasks with one gateway
// nudged 2px off should report the row, not the average of the two.
function dominantCy(members) {
    const counts = new Map();
    for (const n of members) {
        const cy = boxOf(n).cy;
        counts.set(cy, (counts.get(cy) || 0) + 1);
    }
    let best = null;
    for (const [cy, count] of counts) {
        if (!best || count > best.count || (count === best.count && cy < best.cy))
            best = { cy, count };
    }
    return best ? best.cy : 0;
}

// Cluster root-scope nodes into rows by centre-y. This is the whole lane
// concept — inferred per invocation, never stored.
function inferLanes(structure, tol = ALIGN_TOL) {
    const sorted = [...layoutNodes(structure)].sort((a, b) => boxOf(a).cy - boxOf(b).cy);
    const lanes = [];
    for (const n of sorted) {
        const cy = boxOf(n).cy;
        const last = lanes[lanes.length - 1];
        if (last && cy - last.lastCy <= tol) {
            last.members.push(n);
            last.lastCy = cy;
        } else {
            lanes.push({ members: [n], lastCy: cy });
        }
    }
    return lanes.map((l) => ({ cy: dominantCy(l.members), members: l.members.sort(byX) }));
}

function laneOf(lanes, node) {
    return lanes.find((l) => l.members.includes(node)) || null;
}

// The project's own horizontal rhythm: the most common edge-to-edge gap between
// same-lane neighbours. Used as the default for `--gap` so a placement matches
// the diagram it lands in rather than a constant picked here (the corpus mode
// is 60, but the fixture runs 36).
function inferGap(structure, fallback = DEFAULT_GAP) {
    const counts = new Map();
    for (const lane of inferLanes(structure)) {
        for (let i = 1; i < lane.members.length; i++) {
            const prev = boxOf(lane.members[i - 1]);
            const gap = boxOf(lane.members[i]).left - prev.right;
            if (gap <= 0 || gap > MAX_INFERABLE_GAP) continue;
            counts.set(gap, (counts.get(gap) || 0) + 1);
        }
    }
    let best = null;
    for (const [gap, count] of counts) {
        if (!best || count > best.count || (count === best.count && gap < best.gap))
            best = { gap, count };
    }
    return best ? best.gap : fallback;
}

// ---------- routing ----------

// Does an axis-aligned segment pass through a box? Inset by 1px so an edge that
// merely grazes a border (which is where it legitimately attaches) doesn't count.
function segmentCrossesBox(p1, p2, box) {
    const left = box.left + 1;
    const right = box.right - 1;
    const top = box.top + 1;
    const bottom = box.bottom - 1;
    if (right <= left || bottom <= top) return false;
    const minX = Math.min(p1[0], p2[0]);
    const maxX = Math.max(p1[0], p2[0]);
    const minY = Math.min(p1[1], p2[1]);
    const maxY = Math.max(p1[1], p2[1]);
    return minX < right && maxX > left && minY < bottom && maxY > top;
}

function collisions(points, obstacles) {
    let hits = 0;
    for (let i = 1; i < points.length; i++) {
        for (const box of obstacles) {
            if (segmentCrossesBox(points[i - 1], points[i], box)) hits++;
        }
    }
    return hits;
}

// A flow that loops back to its own node: out of the top, around, back in.
function selfLoop(s) {
    const up = s.top - 30;
    return [
        [s.cx, s.top],
        [s.cx, up],
        [s.right + 30, up],
        [s.right + 30, s.cy],
        [s.right, s.cy],
    ];
}

// Force a bend point, snapping it onto the orthogonal grid: leave the source on
// the axis that reaches `via` first, then enter the target on the other axis.
function viaRoute(s, t, via) {
    const [vx, vy] = via;
    const vertical = Math.abs(vy - s.cy) > Math.abs(vx - s.cx);
    if (vertical) {
        return [
            [s.cx, vy > s.cy ? s.bottom : s.top],
            [s.cx, vy],
            [vx, vy],
            [vx, vy > t.cy ? t.bottom : t.top],
        ];
    }
    return [
        [vx > s.cx ? s.right : s.left, s.cy],
        [vx, s.cy],
        [vx, vy],
        [vx > t.cx ? t.right : t.left, vy],
    ];
}

// Orthogonal waypoints between two positioned nodes.
//
// Straight when the two share a row or a column; otherwise one bend, tried
// vertical-first (the corpus style) and falling back to horizontal-first when
// that would cut through another node.
function routeEdge(source, target, opts = {}) {
    const s = boxOf(source);
    const t = boxOf(target);
    if (source.id === target.id) return selfLoop(s);
    if (opts.via) return viaRoute(s, t, opts.via);

    const dx = t.cx - s.cx;
    const dy = t.cy - s.cy;

    if (Math.abs(dy) <= ALIGN_TOL) {
        const y = clamp(
            Math.round((s.cy + t.cy) / 2),
            Math.max(s.top, t.top) + 1,
            Math.min(s.bottom, t.bottom) - 1
        );
        return dx >= 0
            ? [
                  [s.right, y],
                  [t.left, y],
              ]
            : [
                  [s.left, y],
                  [t.right, y],
              ];
    }
    if (Math.abs(dx) <= ALIGN_TOL) {
        const x = clamp(
            Math.round((s.cx + t.cx) / 2),
            Math.max(s.left, t.left) + 1,
            Math.min(s.right, t.right) - 1
        );
        return dy >= 0
            ? [
                  [x, s.bottom],
                  [x, t.top],
              ]
            : [
                  [x, s.top],
                  [x, t.bottom],
              ];
    }

    const verticalFirst = [
        [s.cx, dy > 0 ? s.bottom : s.top],
        [s.cx, t.cy],
        [dx > 0 ? t.left : t.right, t.cy],
    ];
    const horizontalFirst = [
        [dx > 0 ? s.right : s.left, s.cy],
        [t.cx, s.cy],
        [t.cx, dy > 0 ? t.top : t.bottom],
    ];
    const obstacles = opts.obstacles || [];
    return collisions(horizontalFirst, obstacles) < collisions(verticalFirst, obstacles)
        ? horizontalFirst
        : verticalFirst;
}

// Where a named flow's label goes: at the point the edge settles — the bend for
// an elbow, the end point for a straight run — sitting just above it. An
// existing label's box size is preserved so re-routing an unmoved edge is a
// no-op on disk (`labelPos` is a format-only artifact and is excluded from
// agrippa's change detection, but a gratuitous rewrite is still churn).
function labelPosFor(edge, waypoints) {
    if (!edge.name || !waypoints || waypoints.length < 2) return null;
    const anchor = waypoints.length > 2 ? waypoints[1] : waypoints[waypoints.length - 1];
    return {
        x: anchor[0],
        y: anchor[1] - LABEL_OFFSET,
        width: edge.labelPos?.width ?? Math.min(edge.name.length * 6, 140),
        height: edge.labelPos?.height ?? 14,
    };
}

// Every positioned node's box, for collision avoidance and lint.
function obstaclesOf(structure) {
    const boxes = [];
    eachNode(structure.nodes, null, (n) => {
        if (n.layout && !CONTAINER.has(n.type)) boxes.push({ id: n.id, ...boxOf(n) });
    });
    return boxes;
}

// Re-route every sequenceFlow with an endpoint in `ids`, so no command can
// leave waypoints pointing at where a node used to be. Returns the ids of the
// edges it rewrote, the ones already correct, and any it deliberately skipped.
//
// An edge whose computed path matches what is already on disk is left entirely
// untouched — not even its `labelPos` is refreshed. That keeps re-routing
// idempotent (routing a diagram nobody moved is a clean `git diff`) and stops
// layout commands from manufacturing push diffs out of unchanged geometry.
//
// boundaryEvent flows are left alone: their glyph is snapped onto the edge by
// `pb format`, so the two must be recomputed together, not independently.
// Endpoints inside a subProcess/transaction are skipped for the same reason the
// layout ops refuse them (see pbLayoutOps.js).
function rerouteTouching(structure, ids) {
    const set = new Set(ids);
    const rootIds = new Set((structure.nodes || []).map((n) => n.id));
    const byId = new Map();
    eachNode(structure.nodes, null, (n) => byId.set(n.id, n));
    const obstacles = obstaclesOf(structure);

    const rerouted = [];
    const unchanged = [];
    const skipped = [];
    eachNode(structure.nodes, null, (n) => {
        for (const e of n.edges || []) {
            if (!set.has(n.id) && !set.has(e.target)) continue;
            const target = byId.get(e.target);
            if (n.type === 'boundaryEvent' || target?.type === 'boundaryEvent') {
                skipped.push({ id: e.id, why: 'boundary-event flow' });
                continue;
            }
            if (!rootIds.has(n.id) || !rootIds.has(e.target)) {
                skipped.push({ id: e.id, why: 'endpoint inside a container' });
                continue;
            }
            if (!n.layout || !target?.layout) {
                skipped.push({ id: e.id, why: 'endpoint has no layout' });
                continue;
            }
            const own = new Set([n.id, e.target]);
            const wp = routeEdge(n, target, {
                obstacles: obstacles.filter((b) => !own.has(b.id)),
            });
            if (JSON.stringify(wp) === JSON.stringify(e.waypoints)) {
                unchanged.push(e.id);
                continue;
            }
            e.waypoints = wp;
            const lp = labelPosFor(e, wp);
            if (lp) e.labelPos = lp;
            rerouted.push(e.id);
        }
    });
    return { rerouted, unchanged, skipped };
}

// Overall drawing extent — reported by `pb map` and used to show that a
// re-layout actually tightened the diagram.
function extentOf(structure) {
    const boxes = obstaclesOf(structure);
    if (!boxes.length) return { width: 0, height: 0, left: 0, top: 0 };
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.right));
    const top = Math.min(...boxes.map((b) => b.top));
    const bottom = Math.max(...boxes.map((b) => b.bottom));
    return { width: right - left, height: bottom - top, left, top };
}

export {
    ALIGN_TOL,
    DEFAULT_GAP,
    boxOf,
    layoutNodes,
    inferLanes,
    laneOf,
    inferGap,
    routeEdge,
    labelPosFor,
    obstaclesOf,
    segmentCrossesBox,
    rerouteTouching,
    extentOf,
};
