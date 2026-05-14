import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { resolveAddonsPath } from '../lib/addons.js';

async function getToken() {
    const url = process.env.KC_URL;
    const payload = new URLSearchParams();

    payload.append('username', process.env.KC_USER);
    payload.append('password', process.env.KC_PASSWORD);
    payload.append('client_id', process.env.KC_ID);
    payload.append('client_secret', process.env.KC_SECRET);
    payload.append('grant_type', 'password');

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: payload.toString(),
    });

    const json = await response.json();
    return json.access_token;
}

async function getFiles(module_name, token) {
    const url = `${process.env.RIP_URL}/ir.model/xml_prbot`;
    const body = JSON.stringify({ module_name });
    const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    const response = await fetch(url, { method: 'POST', body, headers });
    if (!response.ok) {
        throw new Error(await response.text());
    }
    return await response.json();
}

async function main(module_name) {
    const token = await getToken();
    const files = await getFiles(module_name, token);

    let ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);

    for (const file of files) {
        const buffer = Buffer.from(file.data, 'base64');
        let content = buffer.toString();
        const lines = content.split('\n');

        const odooCloseIndex = lines.findIndex((l) => l.trim() === '</odoo>');
        if (odooCloseIndex !== -1 && odooCloseIndex < lines.length - 1) {
            const footer = lines.slice(odooCloseIndex + 1).join('\n');
            const skippedMatch = footer.match(/Skipped records:\s*(\d+)/);
            if (skippedMatch && parseInt(skippedMatch[1]) > 0) {
                throw new Error(
                    `[${file.name}] Export contains skipped records:\n${footer.trim()}`
                );
            }
            const duplicatedMatch = footer.match(/Duplicated records:\s*(\d+)/);
            if (duplicatedMatch && parseInt(duplicatedMatch[1]) > 0) {
                throw new Error(
                    `[${file.name}] Export contains duplicated records:\n${footer.trim()}`
                );
            }
        }

        if (lines.length > 2) {
            lines.splice(-2);
        }
        content = lines.join('\n');
        content = content.replace(
            /<field name="bpmn_diagram"><!\[CDATA\[[\s\S]*?\]\]><\/field>/g,
            ''
        );

        let destPath;
        if (file.name.includes('Relazioni mancanti')) {
            destPath = `${ADDONS_PATH}/config/${module_name}/data/workflow_missing_relations.xml`;
        } else {
            destPath = `${ADDONS_PATH}/config/${module_name}/data/workflow_configuration.xml`;
        }

        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, content);
        console.log(`Processed: ${file.name} -> ${destPath}`);
    }

    const workflowDir = path.join(ADDONS_PATH, 'config', module_name, 'data');
    const filesToAdd = [
        path.join(workflowDir, 'workflow_missing_relations.xml'),
        path.join(workflowDir, 'workflow_configuration.xml'),
    ];

    for (const filePath of filesToAdd) {
        await new Promise((resolve, reject) => {
            execFile('git', ['add', filePath], { cwd: ADDONS_PATH }, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    const commitMessage = `[IMP][${module_name}] Update workflow`;
    await new Promise((resolve, reject) => {
        execFile('git', ['commit', '-m', commitMessage], { cwd: ADDONS_PATH }, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });

    console.log(`Committed with message: ${commitMessage}`);
}

export { main };
