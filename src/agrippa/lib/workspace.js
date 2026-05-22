import slugify from 'slugify';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname } from 'path';

function toSlug(name) {
    return slugify(name, { lower: true, strict: true });
}

function defaultPhasePath(workflowName, phaseName) {
    return `${toSlug(workflowName)}/${toSlug(phaseName)}.py`;
}

function toMfaSlug(name) {
    return slugify(name, { lower: true, replacement: '_' });
}

function defaultMfaPath(modelName, mfaName) {
    return `${modelName}/${toMfaSlug(mfaName)}.py`;
}

function ensureDir(filePath) {
    const dir = dirname(filePath);
    if (dir && dir !== '.') {
        mkdirSync(dir, { recursive: true });
    }
}

function writeCodeFile(filePath, content) {
    ensureDir(filePath);
    writeFileSync(filePath, (content ?? '').trim() + '\n', 'utf-8');
}

function readCodeFile(filePath) {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
}

function fileExists(filePath) {
    return existsSync(filePath);
}

export { toSlug, defaultPhasePath, defaultMfaPath, ensureDir, writeCodeFile, readCodeFile, fileExists };
