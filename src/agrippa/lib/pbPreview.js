// Quick-and-dirty SVG render of a decomposed wizard's diagram, for eyeballing
// the output of `pb format` during development. Not byte-faithful to the BPMN
// renderer — it just draws each node by type (event=circle, gateway=diamond,
// task=rounded rect, container=rect) and each edge as a waypoint polyline, from
// the geometry in structure.yaml.

import { CONTAINER, eachNode } from './pbEdit.js';

const EVENT = new Set(['startEvent', 'endEvent', 'boundaryEvent']);

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function toSvg(structure) {
    const leaves = [];
    const containers = [];
    const edges = [];
    eachNode(structure.nodes, null, (n) => {
        if (!n.layout) return;
        if (CONTAINER.has(n.type)) containers.push(n);
        else leaves.push(n);
        for (const e of n.edges || []) if (e.waypoints?.length) edges.push(e);
    });
    const anns = (structure.annotations || []).filter((a) => a.layout);
    const assocs = (structure.associations || []).filter((a) => a.waypoints?.length);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const ext = (x, y) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    };
    for (const n of [...leaves, ...containers, ...anns]) {
        const l = n.layout;
        ext(l.x, l.y);
        ext(l.x + l.width, l.y + l.height);
    }
    for (const e of [...edges, ...assocs]) for (const [x, y] of e.waypoints) ext(x, y);
    if (!Number.isFinite(minX)) {
        minX = 0;
        minY = 0;
        maxX = 100;
        maxY = 100;
    }

    const pad = 40;
    const W = Math.round(maxX - minX + pad * 2);
    const H = Math.round(maxY - minY + pad * 2);
    const ox = pad - minX;
    const oy = pad - minY;

    const out = [];
    out.push(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif" font-size="11">`
    );
    out.push(
        '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">' +
            '<path d="M0,0 L8,3 L0,6 z" fill="#444"/></marker></defs>'
    );
    out.push('<rect width="100%" height="100%" fill="#fff"/>');

    const label = (cx, cy, text) =>
        text
            ? `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle">${esc(text)}</text>`
            : '';

    // containers behind everything
    for (const n of containers) {
        const l = n.layout;
        const x = l.x + ox;
        const y = l.y + oy;
        out.push(
            `<rect x="${x}" y="${y}" width="${l.width}" height="${l.height}" rx="8" fill="#f5f7fa" stroke="#9aa7b4"/>`
        );
        out.push(
            `<text x="${x + 8}" y="${y + 16}" font-weight="bold">${esc(n.name || n.type)}</text>`
        );
    }
    // edges
    for (const e of edges) {
        const pts = e.waypoints.map(([x, y]) => `${x + ox},${y + oy}`).join(' ');
        out.push(
            `<polyline points="${pts}" fill="none" stroke="#444" stroke-width="1.5" marker-end="url(#arrow)"/>`
        );
        if (e.name) {
            const m = e.waypoints[Math.floor(e.waypoints.length / 2)];
            out.push(
                `<text x="${m[0] + ox}" y="${m[1] + oy - 4}" text-anchor="middle" fill="#666" font-size="9">${esc(e.name)}</text>`
            );
        }
    }
    for (const a of assocs) {
        const pts = a.waypoints.map(([x, y]) => `${x + ox},${y + oy}`).join(' ');
        out.push(
            `<polyline points="${pts}" fill="none" stroke="#888" stroke-width="1" stroke-dasharray="3,3"/>`
        );
    }
    // annotations
    for (const a of anns) {
        const l = a.layout;
        const x = l.x + ox;
        const y = l.y + oy;
        out.push(
            `<rect x="${x}" y="${y}" width="${l.width}" height="${l.height}" fill="#fffbe6" stroke="#d4b106"/>`
        );
        out.push(
            `<text x="${x + 4}" y="${y + 14}" font-size="9">${esc((a.text || '').slice(0, 40))}</text>`
        );
    }
    // leaf shapes on top
    for (const n of leaves) {
        const l = n.layout;
        const x = l.x + ox;
        const y = l.y + oy;
        const cx = x + l.width / 2;
        const cy = y + l.height / 2;
        if (EVENT.has(n.type)) {
            const sw = n.type === 'endEvent' ? 3 : 1.5;
            out.push(
                `<circle cx="${cx}" cy="${cy}" r="${l.width / 2}" fill="#fff" stroke="#333" stroke-width="${sw}"/>`
            );
            out.push(label(cx, y + l.height + 10, n.name));
        } else if (n.type === 'exclusiveGateway') {
            const p = `${cx},${y} ${x + l.width},${cy} ${cx},${y + l.height} ${x},${cy}`;
            out.push(`<polygon points="${p}" fill="#fff" stroke="#333"/>`);
            out.push(
                `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="13">&#215;</text>`
            );
            out.push(label(cx, y + l.height + 10, n.name));
        } else {
            const fill =
                n.type === 'userTask' ? '#e6f4ff' : n.type === 'serviceTask' ? '#f0ffe6' : '#fff';
            out.push(
                `<rect x="${x}" y="${y}" width="${l.width}" height="${l.height}" rx="8" fill="${fill}" stroke="#333"/>`
            );
            out.push(label(cx, cy, n.name));
        }
    }
    out.push('</svg>');
    return out.join('\n');
}

export { toSvg };
