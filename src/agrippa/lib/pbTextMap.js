// A text rendering of a diagram's geometry, for whoever cannot see an SVG.
//
// `pb preview` renders the diagram for a human to eyeball. This is the same
// job for an agent driving the layout commands from a terminal: rows top to
// bottom, nodes left to right within each row, with the x each one sits at and
// which neighbours are actually connected. Without it, every layout edit is
// made blind and can only be checked by a human opening the real editor.
//
// One line (wrapped) per row rather than a 2D character grid: the real corpus
// has a project with 95 nodes on a single row, which no grid render survives.

import { CONTAINER, eachNode } from './pbEdit.js';
import { boxOf, extentOf, inferGap, inferLanes } from './pbGeometry.js';

const WRAP_AT = 96;

const EVENTISH = new Set([
    'startEvent',
    'endEvent',
    'boundaryEvent',
    'intermediateCatchEvent',
    'intermediateThrowEvent',
]);

function glyph(n, text) {
    if (EVENTISH.has(n.type)) return `(${text})`;
    if (n.type.endsWith('Gateway')) return `<${text}>`;
    if (CONTAINER.has(n.type)) return `{${text}}`;
    return `[${text}]`;
}

// Wrap a row's entries, hanging-indenting continuations under the first entry.
function wrap(prefix, parts) {
    const indent = ' '.repeat(prefix.length);
    const lines = [];
    let line = prefix;
    for (const part of parts) {
        if (line.length + part.length > WRAP_AT && line.trim()) {
            lines.push(line);
            line = indent;
        }
        line += part;
    }
    if (line.trim()) lines.push(line);
    return lines;
}

function toTextMap(structure, { ids = false, lane: only, name } = {}) {
    const lanes = inferLanes(structure);
    const gap = inferGap(structure);
    const extent = extentOf(structure);

    let nodeCount = 0;
    eachNode(structure.nodes, null, () => nodeCount++);

    // Which flows connect two nodes directly, so the map can show a row's chain
    // and, separately, every flow that leaves its row.
    const laneIdx = new Map();
    lanes.forEach((l, i) => l.members.forEach((n) => laneIdx.set(n.id, i)));
    const direct = new Set();
    const crossing = [];
    const byId = new Map();
    eachNode(structure.nodes, null, (n) => byId.set(n.id, n));
    eachNode(structure.nodes, null, (n) => {
        for (const e of n.edges || []) {
            direct.add(`${n.id} ${e.target}`);
            const a = laneIdx.get(n.id);
            const b = laneIdx.get(e.target);
            if (a === undefined || b === undefined || a === b) continue;
            crossing.push({ edge: e, source: n, target: byId.get(e.target) });
        }
    });

    const out = [];
    const title = name || structure.process?.name || structure.process?.id || 'diagram';
    out.push(
        `${title} - ${nodeCount} node(s), ${lanes.length} row(s), ` +
            `${extent.width}x${extent.height}, spacing ${gap}px`
    );
    out.push('');

    for (const lane of lanes) {
        if (only !== undefined && lane.cy !== only) continue;
        const prefix = `  y=${String(lane.cy).padEnd(5)}`;
        const parts = [];
        lane.members.forEach((n, i) => {
            if (i > 0) {
                const prev = lane.members[i - 1];
                const linked = direct.has(`${prev.id} ${n.id}`) || direct.has(`${n.id} ${prev.id}`);
                const hole = boxOf(n).left - boxOf(prev).right;
                parts.push(linked ? ' -> ' : '    ');
                if (hole > gap * 2) parts.push(`..${hole}px.. `);
            }
            const text = ids ? n.id : n.name || n.id;
            parts.push(`${glyph(n, text)}@${boxOf(n).x}`);
        });
        out.push(...wrap(prefix, parts));
    }

    if (crossing.length && only === undefined) {
        out.push('');
        out.push('  flows between rows:');
        for (const c of crossing) {
            const label = c.edge.name ? `  "${c.edge.name}"` : '';
            const from = ids ? c.source.id : c.source.name || c.source.id;
            const to = ids ? c.target.id : c.target.name || c.target.id;
            // Row centreline, not the node's own centre-y: on a jittery diagram
            // those differ, and a y here that matches no row header above is
            // just confusing.
            const fromY = lanes[laneIdx.get(c.source.id)].cy;
            const toY = lanes[laneIdx.get(c.target.id)].cy;
            out.push(`    y=${fromY} ${from}  ->  y=${toY} ${to}${label}`);
        }
    }

    // Rows only cover root-scope nodes, so say so rather than quietly omitting
    // a container's contents from a map that otherwise looks complete.
    const hidden = [];
    for (const n of structure.nodes || []) {
        if (CONTAINER.has(n.type)) eachNode(n.nodes, null, (c) => hidden.push(c.id));
    }
    if (hidden.length) {
        out.push('');
        out.push(
            `  ${hidden.length} node(s) inside containers are not placed on rows ` +
                '(use `pb ls`; `pb format` lays out container contents).'
        );
    }

    const orphans = [];
    eachNode(structure.nodes, null, (n) => {
        if (!n.layout && n.type !== 'boundaryEvent') orphans.push(n.id);
    });
    if (orphans.length) {
        out.push('');
        out.push(`  not positioned: ${orphans.join(', ')}`);
    }

    return out.join('\n');
}

export { toTextMap };
