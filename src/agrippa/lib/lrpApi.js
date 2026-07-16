// Symphony long-running-process (LRP) API client. Base = protocol+host of
// IMPORTEXPORT_URL (the tabulator/deployBpmn endpoints live on the Symphony
// host itself, not under the import/export path). Auth uses the same
// Keycloak bearer as everything else (getToken()).
//
// Unlike PBs, LRPs have no stable guid: the tabulator `id` changes on every
// save/version bump (confirmed live — a re-fetched id differs from a
// previously captured one for the same process). The process `name` is the
// only stable identifier, so every write re-resolves the current id/tenantId
// by name immediately before acting on it.

import fetch from 'node-fetch';

function getSymphonyBase() {
    const url = process.env.IMPORTEXPORT_URL;
    if (!url) throw new Error('IMPORTEXPORT_URL is not configured. Run `prbot init`.');
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
}

// List/search processes by name (server-side `like` filter when nameFilter is
// set; unfiltered page otherwise). Returns the richer per-row fields the save
// body needs (tenantId, svg), not just id/name.
async function listLrps(token, nameFilter, signal) {
    const base = getSymphonyBase();
    const size = nameFilter ? 20 : 12;
    const params = encodeURIComponent(JSON.stringify({ page: 1, size, sorters: [], filters: [] }));
    const otherfilters = encodeURIComponent(
        JSON.stringify([
            { field: 'id', type: '=', value: null },
            { field: 'name', type: 'like', value: nameFilter ?? null },
            { field: 'tenantId', type: '=', value: null },
            { field: 'latestVersion', type: '=', value: true },
        ])
    );
    const othersort = encodeURIComponent(
        JSON.stringify({ field: 'lastModifiedDate', dir: 'desc' })
    );
    const url = `${base}/symphony/restInfo/ajax/tabulator?params=${params}&connector=SymphBpmnFileTabCon&otherfilters=${otherfilters}&card=true&othersort=${othersort}`;

    const res = await fetch(url, {
        headers: { accept: 'application/json', Authorization: `Bearer ${token}` },
        signal,
    });
    if (!res.ok) throw new Error(`LRP list failed with ${res.status}: ${await res.text()}`);
    const json = await res.json();

    const rows = [];
    for (const row of json.data || []) {
        for (let i = 1; i <= 4; i++) {
            const cell = row[`cellContent${i}`];
            if (cell && cell.id && cell.name) {
                rows.push({
                    id: String(cell.id),
                    name: cell.name,
                    tenantId: cell.tenantId,
                    version: cell.version,
                    status: cell.status,
                    bpmnFileSvg: cell.bpmnFileSvg,
                });
            }
        }
    }
    return rows;
}

// Resolve the current row for a process by its stable name (exact match
// against the server-side `like` search results) — the id-by-name lookup
// that replaces PB's guid-based addressing everywhere.
async function resolveLrpByName(token, name) {
    const rows = await listLrps(token, name);
    const row = rows.find((r) => r.name === name);
    if (!row) throw new Error(`No long-running process found with name "${name}"`);
    return row;
}

// Fetch the full BPMN XML + description for one process by id. The endpoint
// returns an HTML/JS fragment (not JSON) — the real payload is a base64
// `doc.value` assignment plus a set of `bpmn_*` hidden inputs.
async function getLrpXml(token, id) {
    const base = getSymphonyBase();
    const url = `${base}/symphony/restInfo/ajax/tabulator/id/${id}?connector=SymphBpmnFileTabCon&modelroot=/management/development/edit`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`LRP detail fetch failed with ${res.status}: ${await res.text()}`);
    const text = await res.text();

    const docMatch = text.match(/doc\.value\s*=\s*'([^']+)'/);
    if (!docMatch) throw new Error('Could not find doc.value in LRP detail response');
    const filenameMatch = text.match(/filename\.value\s*=\s*'([^']+)'/);
    if (!filenameMatch) throw new Error('Could not find filename.value in LRP detail response');
    const descMatch = text.match(/name="bpmn_description"\s+value="([^"]*)"/);

    return {
        xml: Buffer.from(docMatch[1], 'base64').toString('utf-8'),
        filename: filenameMatch[1],
        description: descMatch ? descMatch[1] : '',
    };
}

// Save (PATCH) the wizard's BPMN back to Symphony. `row` must carry the
// CURRENT id/tenantId (re-resolved by name immediately before this call —
// see resolveLrpByName) and `bpmnFileSvg` (the last-known diagram thumbnail,
// echoed back unchanged per the agreed approach — it's display-only, the
// server deploys from the XML, not the SVG). `newVersion:false` saves the
// process in place rather than creating a new version.
async function saveLrp(token, row, xml, description = '') {
    const base = getSymphonyBase();
    const url = `${base}/symphony/restInfo/ajax/tabulator/${row.id}?connector=SymphBpmnFileTabCon`;
    const body = {
        id: row.id,
        tenantId: row.tenantId,
        newVersion: false,
        description,
        name: row.name,
        bpmnFile: Buffer.from(xml, 'utf-8').toString('base64'),
        bpmnFileSvg: row.bpmnFileSvg ?? '',
        oldTenantId: row.tenantId,
    };
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LRP save failed with ${res.status}: ${await res.text()}`);
    const responseText = await res.text();
    return responseText ? JSON.parse(responseText) : null;
}

// Resolve-by-name + fetch detail in one call — the shape both pull's
// classification step and pullLrpEntry/pushLrpEntry need: the current row
// (id/tenantId/svg, re-resolved fresh — never trust a stale one) plus a
// decompose-ready payload.
async function fetchUpstream(token, name) {
    const row = await resolveLrpByName(token, name);
    const { xml, description } = await getLrpXml(token, row.id);
    return { row: { ...row, description }, payload: { built_page: xml } };
}

// Deploy a saved process so live consumers see the latest version.
async function deployLrp(token, id) {
    const base = getSymphonyBase();
    const url = `${base}/symphony/restInfo/ajax/deployBpmn`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error(`LRP deploy failed with ${res.status}: ${await res.text()}`);
    const responseText = await res.text();
    return responseText ? JSON.parse(responseText) : null;
}

export { listLrps, resolveLrpByName, getLrpXml, saveLrp, deployLrp, fetchUpstream };
