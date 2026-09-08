// Geometry lint for a decomposed process-builder diagram.
//
// Deliberately NOT part of `lintAll` in pbEdit.js. Those rules are structural
// and hold at every moment; these describe the *drawing*, and `pb add`/`pb
// connect` intentionally leave a node at a placeholder position with a
// centre-to-centre stub waypoint until it is placed. Folding these in would
// make every structural edit report failures that are the documented, expected
// intermediate state. They surface through `pb lint --layout` and `pb map`.
//
// The point of these rules is a feedback loop: before them, the only way to
// know whether a layout edit came out well was for a human to open the real
// editor. `pb preview` renders an SVG, which is the human's answer, not an
// agent's. These are checkable from a terminal.

import { CONTAINER, eachNode } from './pbEdit.js';
import { ALIGN_TOL, boxOf, inferLanes, obstaclesOf, segmentCrossesBox } from './pbGeometry.js';
import { computeHappyEdges } from './pbLayout.js';

// A waypoint this far off a node's border still counts as attached to it.
const ATTACH_TOL = 2;
// A node further than this off its row's centreline is off the row. Measured
// against the real corpus: 8 of 15 projects have exactly zero nodes off-row
// (the hand-tuned ones), while automatically laid-out diagrams have dozens,
// deviating by up to 108px. There is no middle ground to accommodate.
const OFF_ROW_TOL = 2;
// Two row centrelines closer together than this are a near-miss, not two rows —
// nodes are 36–84px tall, so deliberate rows sit much further apart.
const JITTER_TOL = 30;
// A flow between rows whose endpoints are further apart than the router's
// straight-line tolerance but by less than this is a near-miss column: a few px
// from being a clean vertical drop. Beyond it, the offset is deliberate.
const COLUMN_JITTER_TOL = 40;

function labelOf(n) {
    return n.name ? `${n.id} (${n.name})` : n.id;
}

function onBorder(pt, box) {
    const [x, y] = pt;
    const insideX = x >= box.left - ATTACH_TOL && x <= box.right + ATTACH_TOL;
    const insideY = y >= box.top - ATTACH_TOL && y <= box.bottom + ATTACH_TOL;
    if (!insideX || !insideY) return false;
    return (
        Math.abs(x - box.left) <= ATTACH_TOL ||
        Math.abs(x - box.right) <= ATTACH_TOL ||
        Math.abs(y - box.top) <= ATTACH_TOL ||
        Math.abs(y - box.bottom) <= ATTACH_TOL
    );
}

// Every sequenceFlow paired with its source and target node.
function eachFlow(structure, fn) {
    const byId = new Map();
    eachNode(structure.nodes, null, (n) => byId.set(n.id, n));
    eachNode(structure.nodes, null, (n) => {
        for (const e of n.edges || []) {
            const target = byId.get(e.target);
            if (target) fn(e, n, target);
        }
    });
}

// Two node boxes occupy the same space — always a mistake, never a style choice.
function lintNodeOverlap(structure) {
    const boxes = obstaclesOf(structure);
    const byId = new Map();
    eachNode(structure.nodes, null, (n) => byId.set(n.id, n));
    const issues = [];
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            if (a.right <= b.left || b.right <= a.left) continue;
            if (a.bottom <= b.top || b.bottom <= a.top) continue;
            issues.push(
                `node-overlap: ${labelOf(byId.get(a.id))} overlaps ${labelOf(byId.get(b.id))}.`
            );
        }
    }
    return issues;
}

// A flow drawn straight through an unrelated node. `pb route` avoids these when
// it can pick a clear side; one surviving here needs an explicit `--via`.
function lintEdgeThroughNode(structure) {
    const boxes = obstaclesOf(structure);
    const issues = [];
    eachFlow(structure, (e, source, target) => {
        const wp = e.waypoints || [];
        if (wp.length < 2) return;
        const hit = new Set();
        for (let i = 1; i < wp.length; i++) {
            for (const box of boxes) {
                if (box.id === source.id || box.id === target.id) continue;
                if (segmentCrossesBox(wp[i - 1], wp[i], box)) hit.add(box.id);
            }
        }
        if (!hit.size) return;
        // One finding per edge, not per edge/node pair: a single long flow
        // across a tangled diagram can cross a dozen nodes, and reporting each
        // crossing separately buries every other rule's output.
        const shown = [...hit].slice(0, 3);
        issues.push(
            `edge-through-node: ${source.id} → ${target.id} (${e.id}) is drawn through ` +
                `${hit.size} node(s): ${shown.join(', ')}${hit.size > shown.length ? ', …' : ''}.`
        );
    });
    return issues;
}

// A segment that is neither horizontal nor vertical. The real corpus is ~100%
// orthogonal, so this reliably means a stub `pb connect` left behind, or a
// hand-edit — not a deliberate style.
function lintDiagonalSegments(structure) {
    const issues = [];
    eachFlow(structure, (e, source, target) => {
        const wp = e.waypoints || [];
        for (let i = 1; i < wp.length; i++) {
            if (wp[i][0] !== wp[i - 1][0] && wp[i][1] !== wp[i - 1][1]) {
                issues.push(
                    `diagonal-segment: ${source.id} → ${target.id} (${e.id}) has a diagonal ` +
                        `segment ${JSON.stringify(wp[i - 1])}→${JSON.stringify(wp[i])} — run \`pb route\`.`
                );
                break;
            }
        }
    });
    return issues;
}

// The invariant that makes moving a node by hand safe: an edge's ends must sit
// on the borders of the nodes it connects. A stale waypoint means something was
// moved without re-routing, and the arrow now points at empty space.
//
// boundaryEvent flows are exempt: `pb format` snaps the glyph onto the edge, so
// the edge starts at the event's centre by construction.
function lintStaleWaypoints(structure) {
    const issues = [];
    eachFlow(structure, (e, source, target) => {
        if (source.type === 'boundaryEvent' || target.type === 'boundaryEvent') return;
        if (!source.layout || !target.layout) return;
        const wp = e.waypoints || [];
        if (wp.length < 2) return;
        if (!onBorder(wp[0], boxOf(source))) {
            issues.push(
                `stale-waypoints: ${source.id} → ${target.id} (${e.id}) does not start on ` +
                    `${source.id}'s border — run \`pb route\`.`
            );
        }
        if (!onBorder(wp[wp.length - 1], boxOf(target))) {
            issues.push(
                `stale-waypoints: ${source.id} → ${target.id} (${e.id}) does not end on ` +
                    `${target.id}'s border — run \`pb route\`.`
            );
        }
    });
    return issues;
}

// Rows that are nearly, but not exactly, rows. Legibility depends on a row
// being flat; a handful of px of vertical wobble is something a human never
// introduces on purpose but an automatic layer assignment produces constantly.
//
// Reported per row rather than per node: an auto-laid-out diagram can have
// ninety off-row nodes, and ninety findings would bury everything else.
function lintLaneJitter(structure) {
    const lanes = inferLanes(structure);
    const issues = [];

    for (const lane of lanes) {
        const off = lane.members.filter((n) => Math.abs(boxOf(n).cy - lane.cy) > OFF_ROW_TOL);
        if (!off.length) continue;
        const devs = off.map((n) => Math.abs(boxOf(n).cy - lane.cy));
        const shown = off.slice(0, 4).map((n) => n.id);
        issues.push(
            `lane-jitter: row y=${lane.cy} has ${off.length} of ${lane.members.length} node(s) ` +
                `sitting ${Math.min(...devs)}–${Math.max(...devs)}px off the row ` +
                `(${shown.join(', ')}${off.length > shown.length ? ', …' : ''}).`
        );
    }

    for (let i = 1; i < lanes.length; i++) {
        const gap = lanes[i].cy - lanes[i - 1].cy;
        if (gap > 0 && gap <= JITTER_TOL) {
            issues.push(
                `lane-jitter: rows at y=${lanes[i - 1].cy} and y=${lanes[i].cy} are only ${gap}px ` +
                    `apart (${lanes[i - 1].members.length} and ${lanes[i].members.length} node(s)) — ` +
                    'near-miss rows read as a wobble, not two rows.'
            );
        }
    }
    return issues;
}

// A flow that drops between rows and *nearly* runs straight down. These
// diagrams are read by column as much as by row — a loop-control gateway under
// the gateway it belongs to, an error branch under the step it guards — and a
// 20px offset turns a clean vertical drop into a three-segment jog for no
// reason. Almost always the residue of moving one row without the other
// (`compact --lane`, or a hand edit), which nothing else here would catch:
// across all 15 real projects this rule fires zero times.
function lintColumnJitter(structure) {
    const lanes = inferLanes(structure);
    const laneIdx = new Map();
    lanes.forEach((l, i) => l.members.forEach((n) => laneIdx.set(n.id, i)));

    const issues = [];
    eachFlow(structure, (e, source, target) => {
        const a = laneIdx.get(source.id);
        const b = laneIdx.get(target.id);
        if (a === undefined || b === undefined || a === b) return;
        const off = Math.abs(boxOf(source).cx - boxOf(target).cx);
        if (off <= ATTACH_TOL || off < ALIGN_TOL || off > COLUMN_JITTER_TOL) return;
        issues.push(
            `column-jitter: ${source.id} → ${target.id} (${e.id}) drops between rows but the ` +
                `two are ${off}px out of column — align them for a straight drop ` +
                `(\`pb place --id ${target.id} --at ${source.id}\`).`
        );
    });
    return issues;
}

// A happy-path flow that runs right-to-left. The diagram reads left→right, so
// the main spine going backwards is the single most legible symptom of a
// layout that fought the graph instead of following it.
function lintBackwardFlow(structure, happyOverride) {
    const happy = happyOverride || computeHappyEdges(structure);
    const issues = [];
    eachFlow(structure, (e, source, target) => {
        if (!happy.has(e.id)) return;
        if (!source.layout || !target.layout) return;
        if (CONTAINER.has(source.type) || CONTAINER.has(target.type)) return;
        const s = boxOf(source);
        const t = boxOf(target);
        if (t.cx < s.cx) {
            issues.push(
                `backward-flow: happy-path flow ${source.id} → ${target.id} (${e.id}) runs ` +
                    `right-to-left (x ${s.cx} → ${t.cx}).`
            );
        }
    });
    return issues;
}

// How many findings a single rule may contribute before it is summarised. An
// automatically laid-out 117-node diagram produces hundreds of crossings, which
// would bury the handful of overlaps and stale waypoints that are actually
// worth fixing.
const PER_RULE_CAP = 15;

function capped(issues) {
    const byRule = new Map();
    for (const issue of issues) {
        const rule = issue.slice(0, issue.indexOf(':'));
        if (!byRule.has(rule)) byRule.set(rule, []);
        byRule.get(rule).push(issue);
    }
    const out = [];
    for (const [rule, found] of byRule) {
        out.push(...found.slice(0, PER_RULE_CAP));
        if (found.length > PER_RULE_CAP)
            out.push(`${rule}: … and ${found.length - PER_RULE_CAP} more.`);
    }
    return out;
}

// All geometry rules, most actionable first. `happy` optionally pins the happy
// path (same value `pb format --happy` takes) so the backward-flow rule judges
// the spine the caller actually means, not the one the heuristic guesses.
function lintLayout(structure, { happy, all } = {}) {
    const issues = [
        ...lintNodeOverlap(structure),
        ...lintStaleWaypoints(structure),
        ...lintDiagonalSegments(structure),
        ...lintBackwardFlow(structure, happy),
        ...lintLaneJitter(structure),
        ...lintColumnJitter(structure),
        ...lintEdgeThroughNode(structure),
    ];
    return all ? issues : capped(issues);
}

export {
    lintLayout,
    lintNodeOverlap,
    lintEdgeThroughNode,
    lintDiagonalSegments,
    lintStaleWaypoints,
    lintLaneJitter,
    lintColumnJitter,
    lintBackwardFlow,
};
