import search from '@inquirer/search';
import inquirer from 'inquirer';
import { getToken } from '../../lib/auth.js';
import { fuzzyMatch } from '../../lib/fuzzy.js';
import { log } from '../../lib/logger.js';
import {
    createConfigurator,
    deleteConfigurator,
    getPhaseConfigurators,
    getPhaseResults,
    getPhasesByWorkflow,
    initPhaseRemote,
    listWorkflows,
} from '../lib/api.js';
import { loadEffectiveEnv, readConfig } from '../lib/config.js';

const CODE_TEMPLATE = `logs = []
debug_logs = []
error_occurred = False


def make_log(message, data=None, always=False):
    log_entry = {"message": message}
    if data is not None:
        log_entry["data"] = data

    if always:
        logs.append(log_entry)
    else:
        debug_logs.append(log_entry)


# --------------------------------------


def main():
    pass


try:
    result = main()
except Exception as e:
    error_occurred = True
    make_log(
        "Error occurred in phase",
        {"error": str(e), "traceback": format_exc()},
        always=True,
    )
    case_id.write({"error_message": str(e)})


if error_occurred and debug_logs:
    logs.append({"message": "debug_logs", "logs": debug_logs})

if logs:
    log(json_dumps(logs, indent=2))`;

function generateCode(results) {
    if (!results || results.length === 0) return CODE_TEMPLATE;

    const lines = [];
    const vars = results.map((_, i) => `RES${i + 1}`);
    results.forEach((r, i) => lines.push(`# ${vars[i]} = ${r.name}`));
    lines.push('');
    lines.push(`${vars.join(', ')} = (${vars.map((v) => `"${v}"`).join(', ')})`);
    lines.push('');
    lines.push(CODE_TEMPLATE);
    return lines.join('\n');
}

async function initPhase() {
    const config = readConfig();
    loadEffectiveEnv(config);

    const ripUrl = process.env.RIP_URL;
    if (!ripUrl)
        throw new Error('RIP_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');

    log('Fetching workflows...');
    const token = await getToken();
    const workflows = await listWorkflows(token, ripUrl);

    if (!workflows.length) {
        log('No workflows found.');
        return;
    }

    const workflow = await search({
        message: 'Select a workflow:',
        source: (input) => {
            const filtered = input ? workflows.filter((w) => fuzzyMatch(w.name, input)) : workflows;
            return filtered.map((w) => ({ name: w.name, value: w }));
        },
    });

    log(`Fetching phases for "${workflow.name}"...`);
    const phases = await getPhasesByWorkflow(token, ripUrl, workflow.id);

    if (!phases.length) {
        log('No phases found for this workflow.');
        return;
    }

    const { selectedPhases } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'selectedPhases',
            message: 'Select phases to initialize:',
            choices: phases.map((p) => ({ name: p.name, value: p })),
            loop: false,
        },
    ]);

    if (!selectedPhases.length) {
        log('No phases selected. Aborted.');
        return;
    }

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: `Initialize ${selectedPhases.length} phase(s)? This will overwrite existing code.`,
            default: true,
        },
    ]);

    if (!confirm) {
        log('Aborted.');
        return;
    }

    for (const phase of selectedPhases) {
        // Resolve result objects — API may return IDs or full objects
        let results = phase.allowed_phase_result_ids || [];
        if (results.length > 0 && typeof results[0] === 'number') {
            results = await getPhaseResults(token, ripUrl, results);
        }

        const code = generateCode(results);

        // Delete existing configurator records for this phase
        const existing = await getPhaseConfigurators(token, ripUrl, phase.id);
        for (const cfg of existing) {
            await deleteConfigurator(token, ripUrl, cfg.id);
        }

        // Update phase code + set_result_automatically
        await initPhaseRemote(token, ripUrl, phase.id, code);

        // Create new configurator records for each result
        const vars = results.map((_, i) => `RES${i + 1}`);
        for (let i = 0; i < results.length; i++) {
            await createConfigurator(token, ripUrl, {
                result_value: vars[i],
                code_phase_id: phase.id,
                triplet_phase_result_id: results[i].id,
            });
        }

        log(`Initialized phase "${phase.name}".`);
        if (results.length > 0) {
            log(`  ${results.length} configurator(s) created: ${vars.join(', ')}`);
        }
    }

    log(`Run 'agrippa pull' in workspaces that track this workflow to fetch the updated code.`);
}

export { initPhase };
