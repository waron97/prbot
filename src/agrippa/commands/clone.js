import inquirer from 'inquirer';
import select from '@inquirer/select';
import search from '@inquirer/search';
import { readConfig, writeConfig, loadEffectiveEnv } from '../lib/config.js';
import { listWorkflows, getPhasesByWorkflow, listMfas } from '../lib/api.js';
import { getToken } from '../../lib/auth.js';
import { computeChecksum } from '../lib/checksum.js';
import { toSlug, defaultMfaPath, writeCodeFile } from '../lib/workspace.js';
import { fuzzyMatch } from '../../lib/fuzzy.js';
import { clonePb } from './clonePb.js';

async function clone(opts) {
    if (opts.pb) {
        return clonePb(opts);
    }

    const config = readConfig();
    loadEffectiveEnv(config);

    const ripUrl = process.env.RIP_URL;
    if (!ripUrl) throw new Error('RIP_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');

    // Determine object type
    let objectType = opts.mfa ? 'mfa' : opts.phase ? 'phase' : null;
    if (!objectType) {
        objectType = await select({
            message: 'What do you want to clone?',
            choices: [
                { name: 'MFA', value: 'mfa' },
                { name: 'Phase', value: 'phase' },
            ],
        });
    }

    console.log('Fetching records...');
    const token = await getToken();

    let records;
    if (objectType === 'phase') {
        records = await listWorkflows(token, ripUrl);
    } else {
        records = await listMfas(token, ripUrl);
    }

    if (!records.length) {
        console.log(`No ${objectType} records found.`);
        return;
    }

    // Determine record
    let record;
    if (opts.id) {
        const id = parseInt(opts.id, 10);
        record = records.find((r) => r.id === id);
        if (!record) throw new Error(`No ${objectType} found with id ${opts.id}`);
    } else {
        record = await search({
            message: `Select a ${objectType}:`,
            source: (input) => {
                const filtered = input
                    ? records.filter((r) => fuzzyMatch(r.name, input))
                    : records;
                return filtered.map((r) => ({
                    name: objectType === 'mfa' ? `${r.model_name} / ${r.name}` : r.name,
                    value: r,
                }));
            },
        });
    }

    // Determine path
    let basePath = opts.path ?? null;

    if (objectType === 'phase') {
        if (!basePath) {
            const { inputPath } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'inputPath',
                    message: 'Base directory for phases:',
                    default: toSlug(record.name),
                },
            ]);
            basePath = inputPath;
        }

        console.log(`Fetching phases for "${record.name}"...`);
        const phases = await getPhasesByWorkflow(token, ripUrl, record.id, { fromCode: true });

        if (!phases.length) {
            console.log('No phases found.');
            return;
        }

        for (const phase of phases) {
            const filePath = `${basePath}/${toSlug(phase.name)}.py`;
            writeCodeFile(filePath, phase.code);
            config.workspace.push({
                path: filePath,
                id: phase.id,
                object_type: 'phase',
                workflow_id: record.id,
                workflow_name: record.name,
                checksum_at_pull: computeChecksum(phase.code),
                name: `${record.name} / ${phase.name}`,
            });
            console.log(`  wrote ${filePath}`);
        }

        console.log(`Cloned ${phases.length} phase(s) to ${basePath}/`);
    } else {
        const defaultPath = defaultMfaPath(record.model_name, record.name);
        if (!basePath) {
            const { inputPath } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'inputPath',
                    message: 'Path for MFA file:',
                    default: defaultPath,
                },
            ]);
            basePath = inputPath;
        }

        writeCodeFile(basePath, record.code);
        config.workspace.push({
            path: basePath,
            id: record.id,
            object_type: 'mfa',
            checksum_at_pull: computeChecksum(record.code),
            name: `${record.model_name} / ${record.name}`,
        });
        console.log(`Cloned MFA to ${basePath}`);
    }

    writeConfig(config);
}

export { clone };
