import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import slugify from 'slugify';
import { stringify as yamlStringify } from 'yaml';

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

// Auto-generated, read-only context: dumps the workflow graph returned by the
// `agrippa_describe_workflow` MFA to `<dirPath>/workflow.yml`. Not tracked in the
// workspace -- it is not pushable, it is regenerated on every clone/pull.
function writeWorkflowDoc(dirPath, structure) {
    const filePath = `${dirPath}/workflow.yml`;
    ensureDir(filePath);
    writeFileSync(filePath, yamlStringify(structure, { lineWidth: 0 }), 'utf-8');
    return filePath;
}

export {
    toSlug,
    defaultPhasePath,
    defaultMfaPath,
    ensureDir,
    writeCodeFile,
    readCodeFile,
    fileExists,
    writeWorkflowDoc,
};
