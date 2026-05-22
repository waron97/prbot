import fetch from 'node-fetch';

async function makeRequest(method, path, token, ripUrl, body) {
    const headers = {
        Authorization: `Bearer ${token}`,
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    };
    const res = await fetch(`${ripUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        throw new Error(`API ${method} ${path} failed with ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

function listWorkflows(token, ripUrl) {
    return makeRequest('GET', '/symple.workflow/*', token, ripUrl);
}

function getPhasesByWorkflow(token, ripUrl, workflowId) {
    return makeRequest(
        'GET',
        `/symple.triplet.phase/*?_filter_=[('workflow_id', '=', ${workflowId})]`,
        token,
        ripUrl,
    );
}

function getPhasesByIds(token, ripUrl, ids) {
    return makeRequest(
        'GET',
        `/symple.triplet.phase/*?_filter_=[('id', 'in', [${ids.join(',')}])]`,
        token,
        ripUrl,
    );
}

function updatePhase(token, ripUrl, phaseId, code) {
    return makeRequest('PUT', `/symple.triplet.phase/${phaseId}`, token, ripUrl, { code });
}

function listMfas(token, ripUrl) {
    return makeRequest('GET', '/symple.workflow/get_mfas', token, ripUrl);
}

function updateMfa(token, ripUrl, mfaId, code) {
    return makeRequest('POST', '/symple.workflow/update_mfa', token, ripUrl, { id: mfaId, code });
}

export { listWorkflows, getPhasesByWorkflow, getPhasesByIds, updatePhase, listMfas, updateMfa };
