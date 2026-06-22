// Process-builder model: BPMN XML  <->  editable graph model.
//
// The <process> logic subtree and the <bpmndi> diagram are both parsed into a
// structured model and rebuilt from it (the <definitions> namespace wrapper is
// carried in the manifest). The 0-loss bar is semantic (behavioral): two
// processes are equal iff their *normalized* <process> trees deep-equal
// (whitespace-, attribute-order-, and sibling-order-insensitive, CDATA + attr
// values exact) and their diagrams match structurally. See compareProcess /
// compareDiagram.

import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const XML_OPTS = {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    preserveOrder: true,
    cdataPropName: '__cdata',
    parseTagValue: false,
    trimValues: false,
    suppressEmptyNode: false,
};

const parser = new XMLParser(XML_OPTS);
// format:false is required — formatting injects indentation *inside* CDATA,
// corrupting script bodies. built_page is machine-reassembled, never hand-edited.
const builder = new XMLBuilder({ ...XML_OPTS, format: false });

// ---------- preserveOrder tree helpers ----------

function tagOf(node) {
    return Object.keys(node).find((k) => k !== ':@' && k !== '#text' && k !== '__cdata');
}
function attrsOf(node) {
    return node[':@'] || {};
}
function cdataOf(node, tag) {
    // node[tag] is an array of child nodes; find the __cdata holder
    const kids = node[tag];
    if (!Array.isArray(kids)) return null;
    const holder = kids.find((k) => Object.prototype.hasOwnProperty.call(k, '__cdata'));
    if (!holder) return null;
    const inner = holder.__cdata.find((k) => Object.prototype.hasOwnProperty.call(k, '#text'));
    return inner ? inner['#text'] : '';
}
function textOf(node, tag) {
    const kids = node[tag];
    if (!Array.isArray(kids)) return null;
    const t = kids
        .filter((k) => Object.prototype.hasOwnProperty.call(k, '#text'))
        .map((k) => k['#text'])
        .join('');
    return t;
}
function isWhitespace(s) {
    return typeof s === 'string' && s.trim() === '';
}

// Build a preserveOrder element node from {tag, attrs, children}
function el(tag, attrs, children) {
    const node = { [tag]: children || [] };
    if (attrs && Object.keys(attrs).length) node[':@'] = attrs;
    return node;
}
function cdataChild(text) {
    return { __cdata: [{ '#text': text }] };
}
function textChild(text) {
    return { '#text': text };
}

// ---------- node classification ----------

// Container nodes hold their own nested flow elements (and may loop).
// `transaction` is Activiti's transactional subprocess — modeled like subProcess.
const CONTAINER_TAGS = new Set(['subProcess', 'transaction']);

const NODE_TAGS = new Set([
    'startEvent',
    'endEvent',
    'scriptTask',
    'serviceTask',
    'userTask',
    'exclusiveGateway',
    'subProcess',
    'transaction',
    'boundaryEvent',
]);

const PROMOTED_ATTRS = {
    scriptTask: ['@_id', '@_name'],
    serviceTask: ['@_id', '@_name', '@_activiti:class'],
    userTask: ['@_id', '@_name', '@_activiti:formKey'],
    exclusiveGateway: ['@_id', '@_name'],
    subProcess: ['@_id', '@_name'],
    boundaryEvent: ['@_id', '@_name', '@_attachedToRef'],
    startEvent: ['@_id', '@_name'],
    endEvent: ['@_id', '@_name'],
    process_root: ['@_id', '@_name', '@_isExecutable'],
    association: ['@_id', '@_sourceRef', '@_targetRef'],
};

// Collect the non-promoted attributes into a plain map (prefix stripped),
// so rare attrs (@_default, @_activiti:async, scriptFormat, ...) survive.
function extraAttrs(attrs, type) {
    const promoted = new Set(PROMOTED_ATTRS[type] || ['@_id', '@_name']);
    const out = {};
    for (const [k, v] of Object.entries(attrs)) {
        if (promoted.has(k)) continue;
        out[k.replace(/^@_/, '')] = v;
    }
    return out;
}

function parseServiceFields(node) {
    const ext = node.serviceTask?.find((k) => tagOf(k) === 'extensionElements');
    if (!ext) return [];
    const fields = [];
    for (const f of ext.extensionElements) {
        if (tagOf(f) !== 'activiti:field') continue;
        const name = attrsOf(f)['@_name'];
        const strChild = f['activiti:field'].find((k) => tagOf(k) === 'activiti:string');
        const exprChild = f['activiti:field'].find((k) => tagOf(k) === 'activiti:expression');
        if (strChild) {
            fields.push({ name, string: cdataOf(strChild, 'activiti:string') ?? '' });
        } else if (exprChild) {
            fields.push({ name, expression: cdataOf(exprChild, 'activiti:expression') ?? '' });
        } else {
            fields.push({ name }); // empty <activiti:field/>
        }
    }
    return fields;
}

// All attributes of a node as a prefix-stripped map (nothing promoted).
function allAttrs(node) {
    const out = {};
    for (const [k, v] of Object.entries(attrsOf(node))) out[k.replace(/^@_/, '')] = v;
    return out;
}

function parseMultiInstance(node, tag) {
    const mi = node[tag]?.find((k) => tagOf(k) === 'multiInstanceLoopCharacteristics');
    if (!mi) return undefined;
    const out = { attrs: allAttrs(mi) };
    const card = mi.multiInstanceLoopCharacteristics.find((k) => tagOf(k) === 'loopCardinality');
    const comp = mi.multiInstanceLoopCharacteristics.find(
        (k) => tagOf(k) === 'completionCondition'
    );
    if (card)
        out.loopCardinality = { value: textOf(card, 'loopCardinality'), attrs: allAttrs(card) };
    if (comp)
        out.completionCondition = {
            value: textOf(comp, 'completionCondition'),
            attrs: allAttrs(comp),
        };
    return out;
}

function parseErrorEventDef(node, type) {
    const eed = node[type]?.find((k) => tagOf(k) === 'errorEventDefinition');
    if (!eed) return undefined;
    return { ...extraAttrs(attrsOf(eed), type) };
}

// Parse the children of a <process> or <subProcess> element array into model.
function parseFlowChildren(children, parentId, model) {
    for (const child of children) {
        const tag = tagOf(child);
        if (!tag || tag === '#text') continue;
        const attrs = attrsOf(child);

        if (tag === 'documentation') {
            if (parentId === null) model.process.documentation = textOf(child, tag);
            continue;
        }
        if (tag === 'error') {
            model.errors.push({ id: attrs['@_id'], name: attrs['@_name'] });
            continue;
        }
        if (tag === 'textAnnotation') {
            const txtEl = child.textAnnotation.find((k) => tagOf(k) === 'text');
            model.annotations.push({
                id: attrs['@_id'],
                attrs: extraAttrs(attrs, 'textAnnotation'),
                text: txtEl ? textOf(txtEl, 'text') : '',
            });
            continue;
        }
        if (tag === 'association') {
            model.associations.push({
                id: attrs['@_id'],
                sourceRef: attrs['@_sourceRef'],
                targetRef: attrs['@_targetRef'],
                attrs: extraAttrs({ ...attrs }, 'association'),
            });
            continue;
        }
        if (tag === 'sequenceFlow') {
            const cond = child.sequenceFlow?.find((k) => tagOf(k) === 'conditionExpression');
            const doc = child.sequenceFlow?.find((k) => tagOf(k) === 'documentation');
            const edge = {
                id: attrs['@_id'],
                source: attrs['@_sourceRef'],
                target: attrs['@_targetRef'],
            };
            if (attrs['@_name'] !== undefined) edge.name = attrs['@_name'];
            if (parentId) edge.parent = parentId;
            if (cond) {
                edge.condition =
                    cdataOf(cond, 'conditionExpression') ?? textOf(cond, 'conditionExpression');
                const xsi = attrsOf(cond)['@_xsi:type'];
                if (xsi) edge.conditionType = xsi;
            }
            if (doc) edge.documentation = textOf(doc, 'documentation');
            model.edges.push(edge);
            continue;
        }
        if (NODE_TAGS.has(tag)) {
            const n = { id: attrs['@_id'], type: tag };
            if (attrs['@_name'] !== undefined) n.name = attrs['@_name'];
            if (parentId) n.parent = parentId;
            const extra = extraAttrs(attrs, tag);
            if (Object.keys(extra).length) n.attrs = extra;

            const docEl = child[tag]?.find((k) => tagOf(k) === 'documentation');
            if (docEl) n.documentation = textOf(docEl, 'documentation');

            if (tag === 'scriptTask') {
                const scriptEl = child.scriptTask?.find((k) => tagOf(k) === 'script');
                n.script = scriptEl ? (cdataOf(scriptEl, 'script') ?? '') : '';
            } else if (tag === 'serviceTask') {
                if (attrs['@_activiti:class'] !== undefined) n.class = attrs['@_activiti:class'];
                n.fields = parseServiceFields(child);
            } else if (tag === 'userTask') {
                if (attrs['@_activiti:formKey'] !== undefined)
                    n.formKey = attrs['@_activiti:formKey'];
            } else if (tag === 'boundaryEvent') {
                if (attrs['@_attachedToRef'] !== undefined)
                    n.attachedToRef = attrs['@_attachedToRef'];
                const eed = parseErrorEventDef(child, tag);
                if (eed) n.errorEventDefinition = eed;
            } else if (tag === 'endEvent') {
                const eed = parseErrorEventDef(child, tag);
                if (eed) n.errorEventDefinition = eed;
            } else if (CONTAINER_TAGS.has(tag)) {
                const mi = parseMultiInstance(child, tag);
                if (mi) n.multiInstance = mi;
            }
            model.nodes.push(n);

            if (CONTAINER_TAGS.has(tag)) {
                parseFlowChildren(child[tag], n.id, model);
            }
        }
    }
}

// ---------- public: parse built_page -> { ns, processAttrs, model, diagramXml } ----------

function parseProcess(builtPage) {
    const tree = parser.parse(builtPage);
    const defNode = tree.find((n) => tagOf(n) === 'definitions');
    if (!defNode) throw new Error('built_page has no <definitions> root');
    const ns = attrsOf(defNode);
    const procNode = defNode.definitions.find((n) => tagOf(n) === 'process');
    if (!procNode) throw new Error('built_page has no <process>');
    const procAttrs = attrsOf(procNode);

    const model = {
        process: (() => {
            const p = {
                id: procAttrs['@_id'],
                name: procAttrs['@_name'],
                isExecutable: procAttrs['@_isExecutable'],
                documentation: null,
            };
            const extra = extraAttrs(procAttrs, 'process_root');
            if (Object.keys(extra).length) p.attrs = extra;
            return p;
        })(),
        errors: [],
        nodes: [],
        edges: [],
        annotations: [],
        associations: [],
    };
    parseFlowChildren(procNode.process, null, model);

    return { ns, model, diagram: parseDiagram(builtPage) };
}

// ---------- diagram (bpmndi) parse / build ----------
//
// Parsed into a structured object so node bounds and edge waypoints can be
// surfaced (and edited) in structure.yaml. Coordinates are kept as numbers.

function num(v) {
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
}

function parseLabel(labelNode) {
    const b = labelNode['bpmndi:BPMNLabel'].find((k) => tagOf(k) === 'omgdc:Bounds');
    return { attrs: allAttrs(labelNode), bounds: b ? mapBounds(allAttrs(b)) : null };
}
function mapBounds(a) {
    const out = {};
    for (const [k, v] of Object.entries(a)) out[k] = num(v);
    return out;
}

function parseDiagram(builtPage) {
    const tree = parser.parse(builtPage);
    const defNode = tree.find((n) => tagOf(n) === 'definitions');
    const dia = defNode.definitions.find((n) => tagOf(n) === 'bpmndi:BPMNDiagram');
    if (!dia) return null;
    const plane = dia['bpmndi:BPMNDiagram'].find((n) => tagOf(n) === 'bpmndi:BPMNPlane');

    const shapes = [];
    const edges = [];
    for (const c of plane['bpmndi:BPMNPlane']) {
        const tg = tagOf(c);
        if (tg === 'bpmndi:BPMNShape') {
            const bounds = c['bpmndi:BPMNShape'].find((x) => tagOf(x) === 'omgdc:Bounds');
            const label = c['bpmndi:BPMNShape'].find((x) => tagOf(x) === 'bpmndi:BPMNLabel');
            shapes.push({
                attrs: allAttrs(c),
                bounds: bounds ? mapBounds(allAttrs(bounds)) : null,
                label: label ? parseLabel(label) : null,
            });
        } else if (tg === 'bpmndi:BPMNEdge') {
            const wps = c['bpmndi:BPMNEdge']
                .filter((x) => tagOf(x) === 'omgdi:waypoint')
                .map((w) => mapBounds(allAttrs(w)));
            const label = c['bpmndi:BPMNEdge'].find((x) => tagOf(x) === 'bpmndi:BPMNLabel');
            edges.push({
                attrs: allAttrs(c),
                waypoints: wps,
                label: label ? parseLabel(label) : null,
            });
        }
    }
    return { attrs: allAttrs(dia), plane: { attrs: allAttrs(plane) }, shapes, edges };
}

function boundsAttrs(b) {
    return {
        '@_x': String(b.x),
        '@_y': String(b.y),
        '@_width': String(b.width),
        '@_height': String(b.height),
    };
}

// Rebuild <bpmndi> purely from structure.yaml geometry (model graph + geo maps).
// DI element ids are derived (`<id>_di`); the manifest is never consulted. Node
// labels are omitted (renderers auto-place them); edge labels use ELK-computed
// bounds from geo.labelPos when present — only positions, sizes, waypoints and
// subprocess expand-state are authoritative — see compareDiagram.
function buildDiagram(model, geo) {
    if (!geo) return null;
    const shapeEls = [];
    const pushShape = (id) => {
        const b = geo.bounds[id];
        if (!b) return;
        const attrs = { '@_id': `${id}_di`, '@_bpmnElement': id };
        if (geo.expanded[id] !== undefined) attrs['@_isExpanded'] = String(geo.expanded[id]);
        shapeEls.push(el('bpmndi:BPMNShape', attrs, [el('omgdc:Bounds', boundsAttrs(b), [])]));
    };
    for (const n of model.nodes) pushShape(n.id);
    for (const a of model.annotations || []) pushShape(a.id);

    const edgeEls = [];
    const pushEdge = (id) => {
        const wps = geo.waypoints[id];
        if (!wps) return;
        const children = [];
        const lp = geo.labelPos?.[id];
        for (const [x, y] of wps)
            children.push(el('omgdi:waypoint', { '@_x': String(x), '@_y': String(y) }, []));
        if (lp) children.push(el('bpmndi:BPMNLabel', {}, [el('omgdc:Bounds', boundsAttrs(lp), [])]));
        edgeEls.push(el('bpmndi:BPMNEdge', { '@_id': `${id}_di`, '@_bpmnElement': id }, children));
    };
    for (const e of model.edges) pushEdge(e.id);
    for (const a of model.associations || []) pushEdge(a.id);

    if (!shapeEls.length && !edgeEls.length) return null;
    const plane = el(
        'bpmndi:BPMNPlane',
        { '@_id': 'BPMNPlane_1', '@_bpmnElement': model.process.id },
        [...shapeEls, ...edgeEls]
    );
    return builder.build([el('bpmndi:BPMNDiagram', { '@_id': 'BPMNDiagram_1' }, [plane])]).trim();
}

// ---------- build: model -> <process> preserveOrder children ----------

function buildFlowChildren(model, parentId) {
    const children = [];

    // documentation (process root only)
    if (parentId === null && model.process.documentation != null) {
        children.push(el('documentation', {}, [textChild(model.process.documentation)]));
    }
    // errors (process root only)
    if (parentId === null) {
        for (const e of model.errors) {
            children.push(el('error', { '@_id': e.id, '@_name': e.name }, []));
        }
    }

    const restoreAttr = (extra) => {
        const out = {};
        for (const [k, v] of Object.entries(extra || {})) out[`@_${k}`] = v;
        return out;
    };

    const incoming = (id) => model.edges.filter((e) => e.target === id).map((e) => e.id);
    const outgoing = (id) => model.edges.filter((e) => e.source === id).map((e) => e.id);

    const flowChildren = (id) => {
        const c = [];
        for (const f of incoming(id)) c.push(el('incoming', {}, [textChild(f)]));
        for (const f of outgoing(id)) c.push(el('outgoing', {}, [textChild(f)]));
        return c;
    };

    // documentation (any node) + incoming/outgoing
    const baseKids = (n) => {
        const c = [];
        if (n.documentation != null) c.push(el('documentation', {}, [textChild(n.documentation)]));
        c.push(...flowChildren(n.id));
        return c;
    };

    for (const n of model.nodes.filter((x) => (x.parent ?? null) === parentId)) {
        const attrs = { '@_id': n.id };
        if (n.name !== undefined) attrs['@_name'] = n.name;

        if (n.type === 'scriptTask') {
            Object.assign(attrs, restoreAttr(n.attrs));
            const kids = baseKids(n);
            kids.push(el('script', {}, [cdataChild(n.script ?? '')]));
            children.push(el('scriptTask', attrs, kids));
        } else if (n.type === 'serviceTask') {
            if (n.class !== undefined) attrs['@_activiti:class'] = n.class;
            Object.assign(attrs, restoreAttr(n.attrs));
            const kids = [];
            if (n.fields && n.fields.length) {
                const fieldEls = n.fields.map((f) => {
                    let inner = [];
                    if (Object.prototype.hasOwnProperty.call(f, 'string')) {
                        inner = [el('activiti:string', {}, [cdataChild(f.string)])];
                    } else if (Object.prototype.hasOwnProperty.call(f, 'expression')) {
                        inner = [el('activiti:expression', {}, [cdataChild(f.expression)])];
                    }
                    return el('activiti:field', { '@_name': f.name }, inner);
                });
                kids.push(el('extensionElements', {}, fieldEls));
            }
            kids.push(...baseKids(n));
            children.push(el('serviceTask', attrs, kids));
        } else if (n.type === 'userTask') {
            if (n.formKey !== undefined) attrs['@_activiti:formKey'] = n.formKey;
            Object.assign(attrs, restoreAttr(n.attrs));
            children.push(el('userTask', attrs, baseKids(n)));
        } else if (n.type === 'exclusiveGateway') {
            Object.assign(attrs, restoreAttr(n.attrs));
            children.push(el('exclusiveGateway', attrs, baseKids(n)));
        } else if (n.type === 'startEvent') {
            Object.assign(attrs, restoreAttr(n.attrs));
            children.push(el('startEvent', attrs, baseKids(n)));
        } else if (n.type === 'endEvent') {
            Object.assign(attrs, restoreAttr(n.attrs));
            const kids = baseKids(n);
            if (n.errorEventDefinition) {
                kids.push(el('errorEventDefinition', restoreAttr(n.errorEventDefinition), []));
            }
            children.push(el('endEvent', attrs, kids));
        } else if (n.type === 'boundaryEvent') {
            if (n.attachedToRef !== undefined) attrs['@_attachedToRef'] = n.attachedToRef;
            Object.assign(attrs, restoreAttr(n.attrs));
            const kids = baseKids(n);
            if (n.errorEventDefinition) {
                kids.push(el('errorEventDefinition', restoreAttr(n.errorEventDefinition), []));
            }
            children.push(el('boundaryEvent', attrs, kids));
        } else if (CONTAINER_TAGS.has(n.type)) {
            Object.assign(attrs, restoreAttr(n.attrs));
            const kids = baseKids(n);
            if (n.multiInstance) {
                const mi = n.multiInstance;
                const miKids = [];
                if (mi.loopCardinality) {
                    const lc = mi.loopCardinality;
                    miKids.push(
                        el(
                            'loopCardinality',
                            restoreAttr(lc.attrs),
                            lc.value != null ? [textChild(lc.value)] : []
                        )
                    );
                }
                if (mi.completionCondition) {
                    const cc = mi.completionCondition;
                    miKids.push(
                        el(
                            'completionCondition',
                            restoreAttr(cc.attrs),
                            cc.value != null ? [textChild(cc.value)] : []
                        )
                    );
                }
                kids.push(el('multiInstanceLoopCharacteristics', restoreAttr(mi.attrs), miKids));
            }
            kids.push(...buildFlowChildren(model, n.id)); // nested
            children.push(el(n.type, attrs, kids)); // subProcess | transaction
        }
    }

    // edges scoped to this parent
    for (const e of model.edges.filter((x) => (x.parent ?? null) === parentId)) {
        const attrs = { '@_id': e.id, '@_sourceRef': e.source, '@_targetRef': e.target };
        if (e.name !== undefined) attrs['@_name'] = e.name;
        const kids = [];
        if (e.documentation != null)
            kids.push(el('documentation', {}, [textChild(e.documentation)]));
        if (e.condition != null) {
            const cAttrs = e.conditionType ? { '@_xsi:type': e.conditionType } : {};
            kids.push(el('conditionExpression', cAttrs, [cdataChild(e.condition)]));
        }
        children.push(el('sequenceFlow', attrs, kids));
    }

    // annotations + associations (process root only)
    if (parentId === null) {
        for (const a of model.annotations) {
            children.push(
                el('textAnnotation', { '@_id': a.id, ...restoreAttr(a.attrs) }, [
                    el('text', {}, [textChild(a.text ?? '')]),
                ])
            );
        }
        for (const a of model.associations) {
            children.push(
                el(
                    'association',
                    {
                        '@_id': a.id,
                        '@_sourceRef': a.sourceRef,
                        '@_targetRef': a.targetRef,
                        ...restoreAttr(a.attrs),
                    },
                    []
                )
            );
        }
    }

    return children;
}

// Build the full built_page string from { ns, model, geo }. The <bpmndi> block
// is regenerated solely from `geo` (structure.yaml geometry) — never a manifest.
function buildProcess({ ns, model, geo }) {
    const diagramXml = buildDiagram(model, geo);
    const procAttrs = { '@_id': model.process.id };
    if (model.process.name !== undefined) procAttrs['@_name'] = model.process.name;
    if (model.process.isExecutable !== undefined)
        procAttrs['@_isExecutable'] = model.process.isExecutable;
    for (const [k, v] of Object.entries(model.process.attrs || {})) procAttrs[`@_${k}`] = v;

    const procNode = el('process', procAttrs, buildFlowChildren(model, null));
    const procXml = builder.build([procNode]).trim();

    const defAttrs = Object.entries(ns)
        .map(([k, v]) => `${k.replace(/^@_/, '')}="${v}"`)
        .join(' ');

    // Whitespace between elements is insignificant in XML. The <process> is
    // compact (format:false) to keep CDATA exact; the diagram is regenerated.
    const parts = ['<?xml version="1.0" encoding="UTF-8"?>', `<definitions ${defAttrs}>`, procXml];
    if (diagramXml) parts.push(diagramXml);
    parts.push('</definitions>');
    return parts.join('\n');
}

// ---------- normalize + compare (the 0-loss gate) ----------

// Recursively canonicalize a preserveOrder tree: drop whitespace text, sort
// attributes, sort id-bearing / text-only siblings by a stable key. Returns a
// plain comparable object. CDATA and attribute values are kept exact.
function canon(node) {
    const tag = tagOf(node);
    if (tag === undefined) {
        if (Object.prototype.hasOwnProperty.call(node, '__cdata')) {
            const inner = node.__cdata.map((k) => k['#text'] ?? '').join('');
            return { cdata: inner };
        }
        if (Object.prototype.hasOwnProperty.call(node, '#text')) {
            if (isWhitespace(node['#text'])) return null;
            return { text: node['#text'] };
        }
        return null;
    }
    const attrs = {};
    for (const [k, v] of Object.entries(attrsOf(node))) attrs[k] = v;
    const rawKids = Array.isArray(node[tag]) ? node[tag] : [];
    const kids = rawKids.map(canon).filter((x) => x !== null);
    kids.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    return { tag, attrs, kids };
}

function keyOf(c) {
    if (c.cdata !== undefined) return '~cdata:' + c.cdata;
    if (c.text !== undefined) return '~text:' + c.text;
    const a = c.attrs || {};
    const id = a['@_id'] || a['@_sourceRef'] + '>' + a['@_targetRef'] || '';
    // for incoming/outgoing (no attrs, text child), include child text
    const childKey = (c.kids || []).map((k) => k.text || k.cdata || k.tag || '').join(',');
    return `${c.tag}|${id}|${childKey}`;
}

function normalizeProcessTree(builtPage) {
    const tree = parser.parse(builtPage);
    const defNode = tree.find((n) => tagOf(n) === 'definitions');
    const procNode = defNode.definitions.find((n) => tagOf(n) === 'process');
    return canon(procNode);
}

// Deep structural comparison; returns first diff path or null if equal.
function diff(a, b, path = '$') {
    if (typeof a !== typeof b) return `${path}: type ${typeof a} != ${typeof b}`;
    if (a === null || typeof a !== 'object') {
        return a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: array mismatch`;
        if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
        for (let i = 0; i < a.length; i++) {
            const d = diff(a[i], b[i], `${path}[${i}]`);
            if (d) return d;
        }
        return null;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        const d = diff(a[k], b[k], `${path}.${k}`);
        if (d) return d;
    }
    return null;
}

// Compare two built_page strings at the semantic <process> level.
function compareProcess(builtPageA, builtPageB) {
    return diff(normalizeProcessTree(builtPageA), normalizeProcessTree(builtPageB));
}

// Reduce a parsed diagram to its *semantic* geometry, keyed by bpmnElement:
// per-shape bounds (+ subprocess isExpanded), per-edge ordered waypoints.
// Arbitrary DI element ids, label boxes, and plane/diagram ids are ignored —
// they are regenerated, not preserved (structure.yaml is the source of truth).
function diagramGeometry(builtPage) {
    const d = parseDiagram(builtPage);
    if (!d) return null;
    const shapes = {};
    const edges = {};
    for (const s of d.shapes) {
        const be = s.attrs.bpmnElement;
        if (be == null || !s.bounds) continue;
        const g = {
            x: Number(s.bounds.x),
            y: Number(s.bounds.y),
            width: Number(s.bounds.width),
            height: Number(s.bounds.height),
        };
        if (s.attrs.isExpanded !== undefined) g.isExpanded = String(s.attrs.isExpanded);
        shapes[be] = g;
    }
    for (const e of d.edges) {
        const be = e.attrs.bpmnElement;
        if (be == null) continue;
        edges[be] = (e.waypoints || []).map((w) => [Number(w.x), Number(w.y)]);
    }
    return { shapes, edges };
}

// Compare the bpmndi diagrams of two built_page strings, by geometry only.
function compareDiagram(builtPageA, builtPageB) {
    return diff(diagramGeometry(builtPageA), diagramGeometry(builtPageB));
}

export {
    parseProcess,
    buildProcess,
    parseDiagram,
    normalizeProcessTree,
    compareProcess,
    compareDiagram,
    diff,
};
