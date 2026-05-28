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

function getPhasesByWorkflow(token, ripUrl, workflowId, { fromCode = false } = {}) {
    const filter = fromCode
        ? `[('workflow_id', '=', ${workflowId}), ('set_result_automatically', '=', 'from_code')]`
        : `[('workflow_id', '=', ${workflowId})]`;
    return makeRequest('GET', `/symple.triplet.phase/*?_filter_=${filter}`, token, ripUrl);
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

async function getPhaseResults(token, ripUrl, ids) {
    if (!ids || ids.length === 0) return [];
    try {
        return await makeRequest(
            'GET',
            `/symple.triplet.phase.result/*?_filter_=[('id', 'in', [${ids.join(',')}])]`,
            token,
            ripUrl,
        );
    } catch (err) {
        if (err.message.includes('404')) return [];
        throw err;
    }
}

function initPhaseRemote(token, ripUrl, phaseId, code) {
    return makeRequest('PUT', `/symple.triplet.phase/${phaseId}`, token, ripUrl, {
        set_result_automatically: 'from_code',
        code,
    });
}

async function getPhaseConfigurators(token, ripUrl, phaseId) {
    try {
        return await makeRequest(
            'GET',
            `/result.code.configurator/*?_filter_=[('code_phase_id', '=', ${phaseId})]`,
            token,
            ripUrl,
        );
    } catch (err) {
        if (err.message.includes('404')) return [];
        throw err;
    }
}

function deleteConfigurator(token, ripUrl, id) {
    return makeRequest('DELETE', `/result.code.configurator/${id}`, token, ripUrl);
}

function createConfigurator(token, ripUrl, data) {
    return makeRequest('POST', `/result.code.configurator`, token, ripUrl, data);
}

export {
    listWorkflows,
    getPhasesByWorkflow,
    getPhasesByIds,
    updatePhase,
    listMfas,
    updateMfa,
    getPhaseResults,
    initPhaseRemote,
    getPhaseConfigurators,
    deleteConfigurator,
    createConfigurator,
};
