// Incremental layout operations on a decomposed process-builder diagram.
//
// These sit in the gap between `pb connect` (which stubs geometry and defers
// everything to a full re-layout) and `pb format` (which rebuilds every
// coordinate in the diagram and throws away a hand-tuned arrangement). They let
// a caller say "put this node on that row after that one", "make room here",
// "close this hole", or "re-flow these rows" without doing coordinate
// arithmetic, and without an all-or-nothing ELK pass.
//
// Every op mutates `layout` and `waypoints` only, and every op finishes by
// re-routing the flows it touched, so the diagram is never left with an arrow
// pointing at where a node used to be. Rows are inferred from the geometry on
// each call (see pbGeometry.js) and never stored.
//
// Scope: root-scope nodes only. A node inside a subProcess/transaction is
// refused rather than moved — its container's box is sized by its contents, so
// moving a child means resizing and re-routing the parent too, which is what
// `pb format`'s hierarchical pass already does properly. The real corpus has
// two projects with one container each, so this is a narrow exclusion.

import { CONTAINER, eachNode, findNode } from './pbEdit.js';
import {
    boxOf,
    extentOf,
    inferGap,
    inferLanes,
    labelPosFor,
    obstaclesOf,
    rerouteTouching,
    routeEdge,
} from './pbGeometry.js';

function rootNode(structure, id, what = 'node') {
    const node = (structure.nodes || []).find((n) => n.id === id);
    if (node) {
        if (!node.layout)
            throw new Error(`${what} ${id} has no layout yet — nothing to position it against.`);
        return node;
    }
    const found = findNode(structure, id);
    if (!found) throw new Error(`${what} not found: ${id}`);
    throw new Error(
        `${id} is inside ${found.parent ? found.parent.id : 'a container'} — the layout commands ` +
            'only handle root-scope nodes. Use `pb format` for container contents.'
    );
}

// Lane centreline for a `--lane` argument: an explicit y, or the row an anchor
// node currently sits on.
function resolveLaneCy(structure, { lane, anchor }) {
    if (lane !== undefined && lane !== null) return Number(lane);
    if (anchor) {
        const lanes = inferLanes(structure);
        const found = lanes.find((l) => l.members.some((n) => n.id === anchor.id));
        if (found) return found.cy;
        return boxOf(anchor).cy;
    }
    return null;
}

function setPos(node, x, cy) {
    const b = boxOf(node);
    node.layout = {
        x: Math.round(x),
        y: Math.round(cy - b.height / 2),
        width: b.width,
        height: b.height,
    };
}

// ---------- route ----------

// Recompute waypoints without moving anything. `all` re-routes the whole
// diagram (the repair for a project whose nodes were nudged by hand, or whose
// flows are still `pb connect` stubs); a single edge can be named by id or by
// its endpoints, and `via` forces a bend point through a spot the automatic
// choice got wrong.
function route(structure, { id, from, to, all, touching, via }) {
    if (all) {
        const ids = (structure.nodes || []).map((n) => n.id);
        return rerouteTouching(structure, ids);
    }
    if (touching?.length) return rerouteTouching(structure, touching);
    if (!id && !(from && to)) throw new Error('provide --id, both --from and --to, or --all');

    let found = null;
    const byId = new Map();
    eachNode(structure.nodes, null, (n) => byId.set(n.id, n));
    eachNode(structure.nodes, null, (n) => {
        for (const e of n.edges || []) {
            if (found) return;
            if (id ? e.id === id : n.id === from && e.target === to) found = { node: n, edge: e };
        }
    });
    if (!found) throw new Error(id ? `edge not found: ${id}` : `no flow from ${from} to ${to}`);

    const target = byId.get(found.edge.target);
    if (!found.node.layout || !target?.layout)
        throw new Error(`${found.edge.id}: both endpoints need a layout before routing.`);

    const own = new Set([found.node.id, target.id]);
    const wp = routeEdge(found.node, target, {
        via,
        obstacles: obstaclesOf(structure).filter((b) => !own.has(b.id)),
    });
    const changed = JSON.stringify(wp) !== JSON.stringify(found.edge.waypoints);
    if (changed) {
        found.edge.waypoints = wp;
        const lp = labelPosFor(found.edge, wp);
        if (lp) found.edge.labelPos = lp;
    }
    return {
        rerouted: changed ? [found.edge.id] : [],
        unchanged: changed ? [] : [found.edge.id],
        skipped: [],
    };
}

// ---------- place ----------

// Position one node relative to another (or at an explicit row/x), then
// re-route everything attached to it. `push` first opens a gap wide enough for
// the node, so "insert this into the middle of a row" is a single command.
function place(structure, { id, lane, after, before, at, gap, push }) {
    const node = rootNode(structure, id);
    const step = gap ?? inferGap(structure);

    const anchor = after || before ? rootNode(structure, after || before, 'anchor node') : null;
    const cy = resolveLaneCy(structure, { lane, anchor }) ?? boxOf(node).cy;

    let x = boxOf(node).x;
    if (after) x = boxOf(anchor).right + step;
    else if (before) x = boxOf(anchor).left - step - boxOf(node).width;
    else if (at !== undefined && at !== null) {
        const asNumber = Number(at);
        x = Number.isNaN(asNumber)
            ? boxOf(rootNode(structure, String(at), 'anchor node')).x
            : asNumber;
    }

    let pushed = [];
    if (push) {
        // Diagram-wide, not just this row. These diagrams are read by column as
        // much as by row — a loop-control gateway sits under the gateway it
        // belongs to, an error branch under the step it guards — and shifting
        // one row alone silently breaks every one of those alignments (and can
        // leave the resulting drop cutting straight through another node).
        pushed = shift(structure, {
            fromX: x,
            by: boxOf(node).width + step,
            laneCy: null,
            except: new Set([node.id]),
        });
    }

    setPos(node, x, cy);
    const { rerouted } = rerouteTouching(structure, [node.id, ...pushed]);
    return { id: node.id, x: node.layout.x, y: node.layout.y, cy, pushed, rerouted };
}

// ---------- space / compact ----------

// Move every node at or right of `fromX` by `by` px. Restricted to one row when
// `laneCy` is given, otherwise the whole diagram (which keeps columns aligned
// across rows).
function shift(structure, { fromX, by, laneCy, except }) {
    const lanes = inferLanes(structure);
    const targets =
        laneCy === null || laneCy === undefined
            ? lanes.flatMap((l) => l.members)
            : (lanes.find((l) => l.cy === laneCy)?.members ?? []);
    const moved = [];
    for (const n of targets) {
        if (except?.has(n.id)) continue;
        if (boxOf(n).left < fromX) continue;
        n.layout = { ...n.layout, x: Math.round(n.layout.x + by) };
        moved.push(n.id);
    }
    return moved;
}

// Make room (or take it back, with a negative `by`). The anchor is a node —
// everything strictly to its right moves — or an explicit x.
function space(structure, { after, atX, by, lane }) {
    const step = by ?? inferGap(structure);
    const anchor = after ? rootNode(structure, after, 'anchor node') : null;
    const fromX = anchor ? boxOf(anchor).right + 1 : Number(atX);
    if (Number.isNaN(fromX)) throw new Error('provide --after <id> or --at-x <x>');

    const cy = resolveLaneCy(structure, { lane, anchor: null });
    const before = extentOf(structure).width;
    const moved = shift(structure, { fromX, by: step, laneCy: cy });
    const { rerouted } = rerouteTouching(structure, moved);
    return {
        moved,
        rerouted,
        by: step,
        fromX,
        widthBefore: before,
        widthAfter: extentOf(structure).width,
    };
}

// Close holes in a row. By default only gaps *wider* than the target spacing
// are pulled in, so the hole a removed node left disappears while the row's
// existing rhythm is left alone; `uniform` re-flows every gap to exactly the
// target instead. `from`/`to` bound the range, since a wide gap is sometimes
// deliberate (a loop-back run needs the room).
function compact(structure, { lane, all, after, from, to, gap, uniform }) {
    const step = gap ?? inferGap(structure);
    const lanes = inferLanes(structure);

    // `--after X`: close the single hole immediately right of X, diagram-wide.
    // This is the exact inverse of `place --push` and the answer to "I deleted a
    // node, take its space back" — no arithmetic for the caller, and shifting
    // the whole diagram (not just X's row) keeps every column aligned, for the
    // same reason `place --push` does.
    if (after) {
        const anchor = rootNode(structure, after, 'anchor node');
        const row = lanes.find((l) => l.members.some((n) => n.id === anchor.id));
        const next = row?.members[row.members.indexOf(anchor) + 1];
        if (!next)
            throw new Error(`nothing to the right of ${after} on its row — no hole to close.`);
        const hole = boxOf(next).left - boxOf(anchor).right;
        if (hole <= step) {
            return { moved: [], rerouted: [], closed: [] };
        }
        const moved = shift(structure, {
            fromX: boxOf(anchor).right + 1,
            by: -(hole - step),
            laneCy: null,
        });
        const { rerouted } = rerouteTouching(structure, moved);
        return {
            moved,
            rerouted,
            closed: [{ before: anchor.id, after: next.id, from: hole, to: step }],
        };
    }

    if (!all && (lane === undefined || lane === null))
        throw new Error('provide --after <id>, --lane <y> (see `pb map`), or --all');

    const targets = all ? lanes : lanes.filter((l) => l.cy === Number(lane));
    if (!targets.length) throw new Error(`no row at y=${lane} — see \`pb map\` for the rows.`);

    const moved = [];
    const closed = [];
    for (const l of targets) {
        let started = !from;
        let shiftBy = 0;
        for (let i = 1; i < l.members.length; i++) {
            const prev = l.members[i - 1];
            const node = l.members[i];
            if (!started) {
                if (prev.id === from) started = true;
                else continue;
            }
            if (to && prev.id === to) break;

            const actual = boxOf(node).left - shiftBy - boxOf(prev).right;
            const wanted = uniform ? step : Math.min(actual, step);
            if (actual !== wanted) {
                closed.push({ before: prev.id, after: node.id, from: actual, to: wanted });
                shiftBy += actual - wanted;
            }
            if (shiftBy) {
                node.layout = { ...node.layout, x: Math.round(node.layout.x - shiftBy) };
                moved.push(node.id);
            }
        }
    }
    const { rerouted } = rerouteTouching(structure, moved);
    return { moved, rerouted, closed };
}

// ---------- the batch spec ----------

// Text form of the current geometry: one row per `lane <y>:` header, node ids
// left to right. An id carries an `@anchor` only where its position does *not*
// follow from the previous node plus the default spacing — so the spec shows
// exactly where the layout deviates from a regular rhythm, and everything else
// reads as a plain sequence the caller can reorder freely.
//
// This is scratch input, handed around by path. It is never written into the
// project and never read by recompose: structure.yaml gains no new keys from
// any of this.
function dumpLayout(structure, { gap } = {}) {
    const step = gap ?? inferGap(structure);
    const lanes = inferLanes(structure);

    // Which nodes are joined by a flow — one of the two signals that a shared
    // column is deliberate rather than a coincidence of the current geometry.
    const linked = new Set();
    eachNode(structure.nodes, null, (n) => {
        for (const e of n.edges || []) {
            linked.add(`${n.id} ${e.target}`);
            linked.add(`${e.target} ${n.id}`);
        }
    });

    // A cross-row anchor reads better than a bare number ("same column as that
    // gateway" survives a later shift, a literal x does not) — but only when
    // the two nodes really do belong in one column. Sharing an x is not enough
    // on its own: in an automatically laid-out diagram, unrelated nodes collide
    // on the same x all the time, and anchoring to one of those silently
    // couples them, so editing the spec drags a stranger along. Require the
    // alignment to look intentional: the rows are neighbours (a branch dropping
    // to the row below, parallel branches sharing a column), or the two nodes
    // are directly connected. Anything else gets a plain number, which pins the
    // same position without implying a relationship.
    //
    // Anchors only ever point at an *earlier* row, so a spec can never contain
    // a resolution cycle.
    const emitted = [];
    const anchorFor = (node, x, laneIdx) => {
        const hit = emitted.find(
            (e) =>
                e.x === x &&
                (Math.abs(e.laneIdx - laneIdx) === 1 || linked.has(`${e.id} ${node.id}`))
        );
        return hit ? hit.id : String(x);
    };

    const out = [
        `# ${structure.process?.name || structure.process?.id || 'diagram'} — layout spec`,
        `# Inferred from current geometry; spacing ${step}px. Scratch input, not part of`,
        '# the project. Reorder ids, move them between rows, add or remove `lane <y>:`',
        '# rows, then `pb layout apply`. An id with no @anchor follows the previous one',
        '# at the default spacing. Nodes left out of the spec keep their position.',
        "# Applying is NOT a no-op: every node listed is pulled onto its row's",
        '# centreline and its flows are re-routed. On a diagram already laid out this',
        '# way nothing moves; on one that is not, this is what flattens the rows.',
        '',
    ];

    for (const [laneIdx, lane] of lanes.entries()) {
        const parts = [];
        let prevRight = null;
        for (const n of lane.members) {
            const b = boxOf(n);
            const predicted = prevRight === null ? null : prevRight + step;
            parts.push(predicted === b.x ? n.id : `${n.id}@${anchorFor(n, b.x, laneIdx)}`);
            prevRight = b.right;
        }
        out.push(`lane ${lane.cy}:`);
        // Wrap so a long row stays readable; continuation lines parse the same.
        let line = '   ';
        for (const p of parts) {
            if (line.length + p.length > 96 && line.trim()) {
                out.push(line);
                line = '   ';
            }
            line += ` ${p}`;
        }
        if (line.trim()) out.push(line);
        for (const n of lane.members) emitted.push({ id: n.id, x: boxOf(n).x, laneIdx });
    }
    return out.join('\n') + '\n';
}

function parseSpec(text) {
    const lanes = [];
    let current = null;
    const lines = text.split('\n');
    for (let ln = 0; ln < lines.length; ln++) {
        const line = lines[ln].replace(/#.*$/, '').trim();
        if (!line) continue;
        const header = /^lane\s+(-?\d+)\s*:?(.*)$/.exec(line);
        let rest = line;
        if (header) {
            current = { cy: Number(header[1]), entries: [] };
            lanes.push(current);
            rest = header[2];
        }
        for (const token of rest.split(/\s+/).filter(Boolean)) {
            if (!current)
                throw new Error(`line ${ln + 1}: "${token}" appears before any \`lane <y>:\` row.`);
            const spacer = /^\+(\d+)$/.exec(token);
            if (spacer) {
                current.entries.push({ spacer: Number(spacer[1]) });
                continue;
            }
            const [id, anchor] = token.split('@');
            if (!id) throw new Error(`line ${ln + 1}: malformed entry "${token}".`);
            current.entries.push({ id, anchor });
        }
    }
    return lanes;
}

// Compile a spec back into coordinates. Resolution is lazy and memoised so an
// entry may anchor to a node laid out later in the file; a cycle is reported
// rather than hung on.
function applyLayout(structure, text, { gap } = {}) {
    const step = gap ?? inferGap(structure);
    const spec = parseSpec(text);

    const entries = [];
    const byNodeId = new Map();
    for (const lane of spec) {
        let pending = 0;
        let prev = null;
        for (const e of lane.entries) {
            if (e.spacer !== undefined) {
                pending += e.spacer;
                continue;
            }
            const node = rootNode(structure, e.id);
            if (CONTAINER.has(node.type))
                throw new Error(
                    `${e.id} is a ${node.type} — containers are sized by their contents; use \`pb format\`.`
                );
            if (byNodeId.has(e.id)) throw new Error(`${e.id} appears twice in the spec.`);
            // `prev` is the previous entry on THIS row: a row's first node needs
            // an anchor (or keeps its current x), every later one follows its
            // left-hand neighbour.
            const entry = { node, cy: lane.cy, anchor: e.anchor, extra: pending, prev };
            entries.push(entry);
            byNodeId.set(e.id, entry);
            prev = entry;
            pending = 0;
        }
    }

    const resolving = new Set();
    const xOf = (entry) => {
        if (entry.x !== undefined) return entry.x;
        if (resolving.has(entry.node.id))
            throw new Error(
                `anchor cycle involving ${entry.node.id} — an @anchor chain must terminate.`
            );
        resolving.add(entry.node.id);

        let x;
        if (entry.anchor !== undefined) {
            const asNumber = Number(entry.anchor);
            if (!Number.isNaN(asNumber)) x = asNumber;
            else {
                const other = byNodeId.get(entry.anchor);
                if (other) x = xOf(other);
                else x = boxOf(rootNode(structure, entry.anchor, 'anchor node')).x;
            }
        } else if (entry.prev) {
            x = xOf(entry.prev) + boxOf(entry.prev.node).width + step + entry.extra;
        } else {
            x = boxOf(entry.node).x;
        }

        resolving.delete(entry.node.id);
        entry.x = Math.round(x);
        return entry.x;
    };

    const widthBefore = extentOf(structure).width;
    for (const entry of entries) xOf(entry);

    // Applying a spec is not a read-back of the dump: a row in the spec is a
    // row, so every node in it is pulled onto that centreline. On a diagram
    // already in the house style nothing moves (the fixture round-trips
    // byte-identically); on an automatically laid-out one, this is what
    // flattens the rows — and it is worth reporting rather than doing silently.
    let snapped = 0;
    for (const entry of entries) {
        const before = boxOf(entry.node);
        setPos(entry.node, entry.x, entry.cy);
        if (boxOf(entry.node).y !== before.y) snapped++;
    }

    const { rerouted, skipped } = rerouteTouching(structure, [...byNodeId.keys()]);

    let untouched = 0;
    eachNode(structure.nodes, null, (n) => {
        if (!byNodeId.has(n.id) && n.layout && !CONTAINER.has(n.type)) untouched++;
    });

    return {
        placed: entries.length,
        rows: spec.length,
        untouched,
        snapped,
        rerouted,
        skipped,
        widthBefore,
        widthAfter: extentOf(structure).width,
    };
}

export { route, place, space, compact, dumpLayout, applyLayout, parseSpec };
