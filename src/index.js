#!/usr/bin/env node
import { readdirSync, readFileSync } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import { program } from 'commander';
import { configDotenv } from 'dotenv';
import omelette from 'omelette';
import { autopr } from './commands/autopr.js';
import { changelog } from './commands/changelog.js';
import { commit } from './commands/commit.js';
import { exportPb, exportRip, exportImperex, exportEmailTemplates } from './commands/export.js';
import { init } from './commands/init.js';
import { main as prMain } from './commands/pr.js';
import { verbot } from './commands/ver.js';
import { CONFIG_FILE } from './config.js';

const EXPORT_SUBCOMMANDS = ['workflow', 'email-templates', 'pb', 'imperex', 'rip'];

function replyModules(reply) {
    try {
        const raw = readFileSync(CONFIG_FILE, 'utf-8');
        const match = raw.match(/^ADDONS_PATH=(.+)$/m);
        if (!match) { reply([]); return; }
        const addonsPath = match[1].trim().replace(/^~/, process.env.HOME || '');
        reply(readdirSync(path.join(addonsPath, 'config')));
    } catch {
        reply([]);
    }
}

const completion = omelette('prbot <command> <subOrModule> <module>');
completion.on('command', ({ reply }) => {
    reply(['pr', 'ver', 'init', 'changelog', 'autopr', 'commit', 'export']);
});

// 2nd token: export subcommands or module (for non-export commands)
completion.on('subOrModule', ({ before, reply }) => {
    if (before === 'export') {
        reply(EXPORT_SUBCOMMANDS);
        return;
    }
    if (['init', 'changelog', 'autopr'].includes(before)) {
        reply([]);
        return;
    }
    replyModules(reply);
});

// 3rd token: module (only relevant for export subcommands that take one)
completion.on('module', ({ before, reply }) => {
    if (['workflow', 'email-templates'].includes(before)) {
        replyModules(reply);
    } else {
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

const exportCmd = program.command('export');

exportCmd
    .command('workflow <module>')
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

exportCmd.command('rip').action(() => exportRip());

exportCmd
    .command('pb')
    .option('--no-commit')
    .action((opts) => {
        exportPb(opts).catch((err) => {
            throw err;
        });
    });

exportCmd
    .command('imperex')
    .option('--no-commit')
    .action((opts) => {
        exportImperex(opts).catch((err) => {
            throw err;
        });
    });

exportCmd
    .command('email-templates <module>')
    .option('--no-commit')
    .action((module, opts) => {
        exportEmailTemplates(module, opts).catch((err) => {
            throw err;
        });
    });

program.command('update').action(() => {
    console.log('Updating prbot...');
    execFile('npm', ['i', '-g', '@waron97/prbot'], (error, stdout, stderr) => {
        if (error) {
            console.error(stderr || error.message);
            process.exit(1);
        }
        console.log(stdout);
        console.log('Done.');
    });
});

program.parse();
