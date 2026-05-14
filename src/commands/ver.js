import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { resolveAddonsPath } from '../lib/addons.js';

async function verbot(module_name, level) {
    if (!['major', 'minor', 'patch'].includes(level)) {
        throw new Error('Level must be one of major, minor, patch');
    }

    let ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);

    let manifestPath = path.join(ADDONS_PATH, module_name, '__manifest__.py');
    try {
        await fs.access(manifestPath);
    } catch {
        manifestPath = path.join(ADDONS_PATH, 'config', module_name, '__manifest__.py');
        try {
            await fs.access(manifestPath);
        } catch {
            throw new Error(`__manifest__.py not found for module ${module_name}`);
        }
    }

    const content = await fs.readFile(manifestPath, 'utf-8');
    const versionMatch = content.match(/"version":\s*"(15\.0\.\d+\.\d+\.\d+)"/);
    if (!versionMatch) {
        throw new Error('Version not found in manifest');
    }

    const currentVersion = versionMatch[1];
    const parts = currentVersion.split('.');
    const base = `${parts[0]}.${parts[1]}`;
    const major = parseInt(parts[2]);
    const minor = parseInt(parts[3]);
    const patch = parseInt(parts[4]);

    let newVersion;
    if (level === 'patch') {
        newVersion = `${base}.${major}.${minor}.${patch + 1}`;
    } else if (level === 'minor') {
        newVersion = `${base}.${major}.${minor + 1}.0`;
    } else if (level === 'major') {
        newVersion = `${base}.${major + 1}.0.0`;
    }

    const newContent = content.replace(
        `"version": "${currentVersion}"`,
        `"version": "${newVersion}"`
    );

    await fs.writeFile(manifestPath, newContent);
    console.log(`Updated version: ${currentVersion} -> ${newVersion}`);

    await new Promise((resolve, reject) => {
        execFile('git', ['add', manifestPath], { cwd: ADDONS_PATH }, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });

    const commitMessage = `[VER][${module_name}] Bump`;
    await new Promise((resolve, reject) => {
        execFile('git', ['commit', '-m', commitMessage], { cwd: ADDONS_PATH }, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });

    console.log(`Committed with message: ${commitMessage}`);
}

export { verbot };
