#!/usr/bin/env node
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { program } from 'commander';
import { configDotenv } from 'dotenv';
import omelette from 'omelette';
import { autopr } from './commands/autopr.js';
import { changelog } from './commands/changelog.js';
import { commit } from './commands/commit.js';
import { init } from './commands/init.js';
import { main as prMain } from './commands/pr.js';
import { verbot } from './commands/ver.js';
import { CONFIG_FILE } from './config.js';

const completion = omelette('prbot <command> <module>');
completion.on('command', ({ reply }) => {
    reply(['pr', 'ver', 'init', 'changelog', 'autopr', 'commit']);
});

completion.on('module', ({ before, reply }) => {
    if (['init', 'changelog', 'autopr'].includes(before)) {
        reply([]);
        return;
    }
    try {
        const raw = readFileSync(CONFIG_FILE, 'utf-8');
        const match = raw.match(/^ADDONS_PATH=(.+)$/m);
        if (!match) {
            reply([]);
            return;
        }
        const addonsPath = match[1].trim().replace(/^~/, process.env.HOME || '');
        reply(readdirSync(path.join(addonsPath, 'config')));
    } catch {
        reply([]);
    }
});

completion.init();

const isCompletionMode = process.argv.includes('--compbash') || process.argv.includes('--compzsh');

if (!isCompletionMode) {
    configDotenv({ path: CONFIG_FILE });
}

program
    .command('pr <module>')
    .option('-b, --bump <level>')
    .action((module, opts) => {
        prMain(module)
            .then(() => {
                if (opts.bump) {
                    return verbot(module, opts.bump);
                }
            })
            .catch((err) => {
                throw err;
            });
    });

program
    .command('ver <module>')
    .option('-b, --bump <level>')
    .action((module, opts) => {
        if (!opts.bump) {
            throw new Error('No bump level specified');
        }
        verbot(module, opts.bump);
    });

program
    .command('init')
    .description('Create config file and install shell completion')
    .action(() => {
        init(completion);
    });

const collect = (val, prev) => [...(prev ?? []), val];

program
    .command('changelog <pr>')
    .option('-t, --trident <code>', 'Trident issue codes (repeatable)', collect)
    .option('-j, --jira <code>', 'JIRA issue codes (repeatable)', collect)
    .option('-m, --message <text>', 'Changelog entry message')
    .action((prNumber, opts) => {
        changelog(prNumber, opts).catch((err) => {
            throw err;
        });
    });

program
    .command('autopr')
    .option('-t, --trident <id>', 'Trident task IDs (repeatable)', collect)
    .option('-j, --jira <code>', 'JIRA issue codes (repeatable)', collect)
    .option('-m, --message <text>', 'Changelog entry message')
    .option('-b, --branch <name>', 'Branch name (default: autopr_<taskId>)')
    .option('-n, --name <text>', 'PR title (default: task name from Odoo)')
    .action((opts) => {
        autopr(opts).catch((err) => {
            throw err;
        });
    });

program.command('commit').action((opts) => {
    commit(opts).catch((err) => {
        throw err;
    });
});

program.parse();
