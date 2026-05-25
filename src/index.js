#!/usr/bin/env node
import { execFile } from 'child_process';
import { program } from 'commander';
import { configDotenv } from 'dotenv';
import { autopr } from './commands/autopr.js';
import { changelog } from './commands/changelog.js';
import { commit } from './commands/commit.js';
import { exportPb, exportRip, exportImperex, exportEmailTemplates, exportWorkflow } from './commands/export.js';
import { init } from './commands/init.js';
import { main as prMain } from './commands/pr.js';
import { verbot } from './commands/ver.js';
import { CONFIG_FILE } from './config.js';

configDotenv({ path: CONFIG_FILE, quiet: true });

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
    .description('Create config file')
    .action(() => {
        init();
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
    .command('workflow')
    .option('--no-commit')
    .option('-b, --bump <level>', 'Version bump level (patch, minor, major)')
    .action((opts) => {
        exportWorkflow(opts).catch((err) => {
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
    .command('email-templates')
    .option('--no-commit')
    .option('-e, --exclude <value...>', 'exclude templates matching id, name, or template_code')
    .option('-m, --module <name>', 'module directory name (skip prompt)')
    .option('-w, --workflow <value>', 'workflow name or id (skip prompt)')
    .action((opts) => {
        exportEmailTemplates(opts).catch((err) => {
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
