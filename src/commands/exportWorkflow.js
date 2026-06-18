import fs from 'fs/promises';
import path from 'path';
import { confirm, select } from '@inquirer/prompts';
import search from '@inquirer/search';
import { resolveAddonsPath } from '../lib/addons.js';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { execGit } from '../lib/git.js';
import { isSilent, log } from '../lib/logger.js';
import {
    computeMigrationVersion,
    detectRenames,
    generatePreMigrateScript,
    readWorkflowMappings,
} from '../lib/premigrate.js';
import { runPr } from './pr.js';
import { verbot } from './ver.js';

async function getModuleChoices() {
    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const configDir = path.join(ADDONS_PATH, 'config');
    const entries = await fs.readdir(configDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => ({ name: e.name, value: e.name }));
}

async function resolveManifestPath(module, ADDONS_PATH) {
    for (const candidate of [
        path.join(ADDONS_PATH, module, '__manifest__.py'),
        path.join(ADDONS_PATH, 'config', module, '__manifest__.py'),
    ]) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // try next
        }
    }
    return null;
}

async function exportWorkflow(opts) {
    let module;
    if (opts.module) {
        module = opts.module;
    } else {
        const moduleChoices = await getModuleChoices();
        module = await search({
            message: 'Select module:',
            source: async (input) => {
                if (!input) return moduleChoices;
                return moduleChoices.filter((c) => fuzzyMatch(c.name, input));
            },
        });
    }

    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const dataDir = path.join(ADDONS_PATH, 'config', module, 'data');

    const oldMappings = await readWorkflowMappings(dataDir);

    await runPr(module, { ...opts, commit: false });

    const newMappings = await readWorkflowMappings(dataDir);
    const renames = detectRenames(oldMappings, newMappings);
    const hasRenames = renames.stateCodes.length > 0 || renames.phaseCodes.length > 0;

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

    let preMigratePath = null;

    if (hasRenames) {
        if (renames.stateCodes.length > 0) {
            log(
                `Renamed state_codes (${renames.stateCodes.length}): ${renames.stateCodes.join(', ')}`
            );
        }
        if (renames.phaseCodes.length > 0) {
            log(
                `Renamed phase_codes (${renames.phaseCodes.length}): ${renames.phaseCodes.join(', ')}`
            );
        }

        let shouldGenerate = opts.autoPremigrate;
        if (!shouldGenerate && !isSilent()) {
            shouldGenerate = await confirm({
                message: `Detected ${renames.stateCodes.length} renamed state_code(s) and ${renames.phaseCodes.length} renamed phase_code(s). Generate pre-migrate script?`,
                default: true,
            });
        }

        if (shouldGenerate) {
            const manifestPath = await resolveManifestPath(module, ADDONS_PATH);
            if (!manifestPath) {
                log(
                    `Warning: __manifest__.py not found for ${module}, skipping pre-migrate generation`
                );
            } else {
                const version = await computeMigrationVersion(manifestPath, bumpLevel);
                const migrationDir = path.join(
                    ADDONS_PATH,
                    'config',
                    module,
                    'migrations',
                    version
                );
                preMigratePath = path.join(migrationDir, 'pre-migrate.py');
                await fs.mkdir(migrationDir, { recursive: true });
                await fs.writeFile(
                    preMigratePath,
                    generatePreMigrateScript(renames.stateCodes, renames.phaseCodes)
                );
                log(`Wrote pre-migrate: ${preMigratePath}`);
            }
        }
    }

    if (opts.commit === false) {
        if (bumpLevel && bumpLevel !== 'none') {
            await verbot(module, bumpLevel, { ...opts, commit: false });
        }
        return;
    }

    const filesToAdd = [
        path.join(dataDir, 'workflow_missing_relations.xml'),
        path.join(dataDir, 'workflow_configuration.xml'),
    ];
    if (preMigratePath) filesToAdd.push(preMigratePath);

    for (const filePath of filesToAdd) {
        await execGit(['add', filePath], ADDONS_PATH);
    }

    const commitMessage = `[IMP][${module}] Update workflow`;
    await execGit(['commit', '-m', commitMessage], ADDONS_PATH);
    log(`Committed with message: ${commitMessage}`);

    if (bumpLevel && bumpLevel !== 'none') {
        await verbot(module, bumpLevel, opts);
    }
}

export { exportWorkflow };
