// Process-builder API client. Base URL = PB_URL, e.g.
//   https://sorgenia-test-02.symple.cloud/api/processbuilder/v1
// Auth uses the same Keycloak bearer as import-export (getToken()).

import fetch from 'node-fetch';

function pbBase() {
    const base = process.env.PB_URL;
    if (!base) {
        throw new Error('PB_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');
    }
    return base.replace(/\/+$/, '');
}

async function pbRequest(method, path, token) {
    const res = await fetch(`${pbBase()}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        throw new Error(`PB API ${method} ${path} failed with ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

// List processes. The endpoint returns full objects; we keep only the
// identity fields needed for selection.
async function listProcesses(token) {
    const data = await pbRequest('GET', '/builder/process', token);
    const arr = Array.isArray(data) ? data : (data.data ?? data.results ?? []);
    return arr.map((p) => ({
        guid: p.guid,
        document_id: p.document_id,
        process_name: p.process_name,
        status: p.status,
        version: p.version,
    }));
}

// Fetch the full payload for one process by guid.
function getProcess(token, guid) {
    return pbRequest('GET', `/builder/process/${guid}`, token);
}

export { listProcesses, getProcess };
