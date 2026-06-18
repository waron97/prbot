// Disk IO for a decomposed process-builder project.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';

// Write a { path -> content } file map under baseDir. Content is written
// byte-exact (scripts must not be reformatted).
function writeProject(baseDir, files) {
    for (const [rel, content] of Object.entries(files)) {
        const full = join(baseDir, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content, 'utf-8');
    }
}

// A reader bound to baseDir, suitable for recompose().
function projectReader(baseDir) {
    return (rel) => readFileSync(join(baseDir, rel), 'utf-8');
}

// Relative paths of the page files under <baseDir>/pages.
function listPageFiles(baseDir) {
    const dir = join(baseDir, 'pages');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
        .map((f) => `pages/${f}`);
}

export { writeProject, projectReader, listPageFiles };
