import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { select } from '@inquirer/prompts';
import { CONFIG_DIR } from '../config.js';
import { setSilent } from '../lib/logger.js';
import { exportWorkflow } from './exportWorkflow.js';
import { exportPb } from './exportPb.js';
import { exportImperex } from './exportImperex.js';
import { exportEmailTemplates } from './exportEmailTemplates.js';
import { exportLrp } from './exportLrp.js';

const ROUTINES_FILE = path.join(CONFIG_DIR, 'routines.yaml');
const WORKSPACE_FILE = 'agrippa.yaml';

const COMMAND_MAP = {
    'export workflow': exportWorkflow,
    'export pb': exportPb,
    'export imperex': exportImperex,
    'export lrp': exportLrp,
    'export email-templates': exportEmailTemplates,
};

function loadRoutines() {
    const routines = [];

    if (existsSync(ROUTINES_FILE)) {
        const config = parse(readFileSync(ROUTINES_FILE, 'utf-8'));
        if (config?.routines) routines.push(...config.routines);
    }

    if (existsSync(WORKSPACE_FILE)) {
        const config = parse(readFileSync(WORKSPACE_FILE, 'utf-8'));
        if (config?.routines) routines.push(...config.routines);
    }

    return routines;
}

function stepOpts(step) {
    const opts = { bump: step.bump ?? 'none' };
    if (step.module) opts.module = step.module;
    if (step.workflow) opts.workflow = step.workflow;
    if (step.exclude) opts.exclude = step.exclude;
    if (step.no_commit) opts.commit = false;
    if (step.auto_premigrate) opts.autoPremigrate = true;
    return opts;
}

function isNothingToCommit(err) {
    return err?.gitOutput?.includes('nothing to commit');
}

async function runRoutine(routine) {
    console.log(`Running Routine: ${routine.name}`);

    for (const step of routine.steps) {
        const label = `[${step.name}]`;
        const fn = COMMAND_MAP[step.command];
        if (!fn) {
            console.log(`${label} Unknown command: ${step.command}`);
            continue;
        }

        console.log(`${label} Job started`);
        setSilent(true);

        try {
            await fn(stepOpts(step));
            console.log(`${label} Done (committed)`);
        } catch (err) {
            if (isNothingToCommit(err)) {
                console.log(`${label} Done (nothing to commit)`);
            } else {
                console.log(`${label} Failed: ${err.message}`);
            }
        } finally {
            setSilent(false);
        }
    }
}

async function routine() {
    const routines = loadRoutines();

    if (!routines.length) {
        console.log('No routines defined. Create ~/.config/prbot/routines.yaml or add routines: to agrippa.yaml.');
        return;
    }

    const selected = await select({
        message: 'Select routine:',
        choices: routines.map((r) => ({ name: r.name, value: r })),
    });

    await runRoutine(selected);
}

export { routine };
