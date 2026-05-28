import fs from 'fs/promises';
import path from 'path';
import search from '@inquirer/search';
import { select } from '@inquirer/prompts';
import { resolveAddonsPath } from '../lib/addons.js';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { runPr } from './pr.js';
import { verbot } from './ver.js';

async function getModuleChoices() {
    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const configDir = path.join(ADDONS_PATH, 'config');
    const entries = await fs.readdir(configDir, { withFileTypes: true });
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, value: e.name }));
}

async function exportWorkflow(opts) {
    const moduleChoices = await getModuleChoices();
    const module = await search({
        message: 'Select module:',
        source: async (input) => {
            if (!input) return moduleChoices;
            return moduleChoices.filter((c) => fuzzyMatch(c.name, input));
        },
    });

    await runPr(module, opts);

    let bumpLevel = opts.bump;
    if (!bumpLevel) {
        bumpLevel = await select({
            message: 'Bump version?',
            choices: [
                { name: 'No bump', value: 'none' },
                { name: 'Patch', value: 'patch' },
                { name: 'Minor', value: 'minor' },
                { name: 'Major', value: 'major' },
            ],
        });
    }

    if (bumpLevel && bumpLevel !== 'none') {
        await verbot(module, bumpLevel, opts);
    }
}

export { exportWorkflow };
