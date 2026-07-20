import search from '@inquirer/search';
import select from '@inquirer/select';
import inquirer from 'inquirer';
import { getToken } from '../../lib/auth.js';
import { fuzzyMatch } from '../../lib/fuzzy.js';
import { log, warn } from '../../lib/logger.js';
import { describeWorkflow, getPhasesByWorkflow, listMfas, listWorkflows } from '../lib/api.js';
import { computeChecksum } from '../lib/checksum.js';
import { loadEffectiveEnv, readConfig, writeConfig } from '../lib/config.js';
import { defaultMfaPath, toSlug, writeCodeFile, writeWorkflowDoc } from '../lib/workspace.js';
import { cloneLrp } from './cloneLrp.js';
import { clonePb } from './clonePb.js';

async function clone(opts) {
    if (opts.pb) {
        return clonePb(opts);
    }
    if (opts.lrp) {
        return cloneLrp(opts);
    }

    const config = readConfig();
    loadEffectiveEnv(config);

    // Determine object type (interactive prompt when no flag was passed)
    let objectType = opts.mfa ? 'mfa' : opts.phase ? 'phase' : null;
    if (!objectType) {
        objectType = await select({
            message: 'What do you want to clone?',
            choices: [
                { name: 'MFA', value: 'mfa' },
                { name: 'Phase', value: 'phase' },
                { name: 'Process Builder', value: 'pb' },
                { name: 'Long Running Process', value: 'lrp' },
            ],
        });
    }
    // Process-builder wizards and LRPs have their own clone flow (recompose verify).
    if (objectType === 'pb') return clonePb(opts);
    if (objectType === 'lrp') return cloneLrp(opts);

    const ripUrl = process.env.RIP_URL;
    if (!ripUrl)
        throw new Error('RIP_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');

    log('Fetching records...');
    const token = await getToken();

    let records;
    if (objectType === 'phase') {
        records = await listWorkflows(token, ripUrl);
    } else {
        records = await listMfas(token, ripUrl);
    }

    if (!records.length) {
        log(`No ${objectType} records found.`);
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
                const filtered = input ? records.filter((r) => fuzzyMatch(r.name, input)) : records;
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

        log(`Fetching phases for "${record.name}"...`);
        const phases = await getPhasesByWorkflow(token, ripUrl, record.id, { fromCode: true });

        if (!phases.length) {
            log('No phases found.');
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
            log(`  wrote ${filePath}`);
        }

        // Drop the workflow graph alongside the phase files as read-only context.
        try {
            const structure = await describeWorkflow(token, ripUrl, record.id);
            const docPath = writeWorkflowDoc(basePath, structure);
            log(`  wrote ${docPath}`);
        } catch (err) {
            warn(`  could not fetch workflow structure: ${err.message}`);
        }

        log(`Cloned ${phases.length} phase(s) to ${basePath}/`);
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
        log(`Cloned MFA to ${basePath}`);
    }

    writeConfig(config);
}

export { clone };
