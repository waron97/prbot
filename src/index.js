#!/usr/bin/env node
import { execFile } from 'child_process';
import { program } from 'commander';
import { configDotenv } from 'dotenv';
import { autopr } from './commands/autopr.js';
import { changelog } from './commands/changelog.js';
import { commit } from './commands/commit.js';
import {
    exportEmailTemplates,
    exportImperex,
    exportLrp,
    exportPb,
    exportRip,
    exportWorkflow,
} from './commands/export.js';
import { init } from './commands/init.js';
import { main as prMain } from './commands/pr.js';
import { routine } from './commands/routine.js';
import { verbot } from './commands/ver.js';
import { CONFIG_FILE } from './config.js';
import { error, log, setSilent } from './lib/logger.js';
import { checkForUpdate, currentVersion } from './lib/updateCheck.js';

// Commands that never talk to RIP/DevOps/Trident/Keycloak. They still read
// non-secret config (e.g. ADDONS_PATH) from the same file, but must not end
// up holding credentials in their process env — a coding agent invoking one
// of these should not even technically be able to leak or reuse a secret it
// never needed.
const LOCAL_COMMANDS = new Set(['init', 'ver', 'commit', 'changelog']);
const SECRET_ENV_KEYS = [
    'KC_USER',
    'KC_PASSWORD',
    'KC_ID',
    'KC_SECRET',
    'DEVOPS_TOKEN',
    'TRIDENT_TOKEN',
];
const OFFLINE = process.env.PRBOT_OFFLINE === '1' || process.argv.includes('--offline');

configDotenv({ path: CONFIG_FILE, quiet: true });

const invokedCommand = process.argv[2];
if (LOCAL_COMMANDS.has(invokedCommand)) {
    for (const key of SECRET_ENV_KEYS) delete process.env[key];
}

let _updateAvailable = null;
if (!OFFLINE) {
    checkForUpdate().then((v) => {
        _updateAvailable = v;
    });
}

process.on('exit', () => {
    if (_updateAvailable) {
        log(`\nUpdate available: ${currentVersion} → ${_updateAvailable}\nRun: prbot update`);
    }
});

// Single point of convergence for every command's failure. Exit code 0 must
// mean the requested operation actually succeeded; nothing downstream of
// this should ever swallow an error into a zero exit.
function fail(err) {
    error(`Error: ${err?.message ?? err}`);
    process.exitCode = 1;
}

process.on('unhandledRejection', (err) => {
    fail(err instanceof Error ? err : new Error(String(err)));
});
process.on('uncaughtException', (err) => {
    fail(err);
});

/**
 * Adds `--quiet`/`--silent` to a command and returns a helper that reads
 * both, warning once if the deprecated `--silent` alias is used. `--silent`
 * used to also swallow errors (so a failed export could report success);
 * it no longer does — both flags only suppress informational output.
 */
function withQuiet(cmd) {
    return cmd
        .option('-q, --quiet', 'Suppress informational output (errors still fail the command)')
        .option('-s, --silent', 'Deprecated alias of --quiet; no longer swallows errors');
}

function resolveQuiet(opts) {
    if (opts.silent) {
        error('Warning: --silent is deprecated and no longer swallows errors; use --quiet.');
    }
    return Boolean(opts.quiet || opts.silent);
}

program
    .command('pr <module>')
    .option('-b, --bump <level>')
    .action(async (module, opts) => {
        await prMain(module);
        if (opts.bump) await verbot(module, opts.bump);
    });

program
    .command('ver <module>')
    .option('-b, --bump <level>')
    .action(async (module, opts) => {
        if (!opts.bump) {
            throw new Error('No bump level specified');
        }
        await verbot(module, opts.bump);
    });

program
    .command('init')
    .description('Create config file')
    .action(async () => {
        await init();
    });

const collect = (val, prev) => [...(prev ?? []), val];

program
    .command('changelog <pr>')
    .option('-t, --trident <code>', 'Trident issue codes (repeatable)', collect)
    .option('-j, --jira <code>', 'JIRA issue codes (repeatable)', collect)
    .option('-m, --message <text>', 'Changelog entry message')
    .action(async (prNumber, opts) => {
        await changelog(prNumber, opts);
    });

program
    .command('autopr')
    .option('-t, --trident <id>', 'Trident task IDs (repeatable)', collect)
    .option('-j, --jira <code>', 'JIRA issue codes (repeatable)', collect)
    .option('-m, --message <text>', 'Changelog entry message')
    .option('-b, --branch <name>', 'Branch name (default: autopr_<taskId>)')
    .option('-n, --name <text>', 'PR title (default: task name from Odoo)')
    .option('--amend', 'Amend existing PR on current branch with new trident/jira refs')
    .action(async (opts) => {
        await autopr(opts);
    });

program.command('commit').action(async (opts) => {
    await commit(opts);
});

const exportCmd = program.command('export');

withQuiet(
    exportCmd
        .command('workflow')
        .option('--no-commit')
        .option('-b, --bump <level>', 'Version bump level (patch, minor, major)')
        .option('-m, --module <id>', 'Module/workflow ID to export (skips interactive selection)')
        .option(
            '--auto-premigrate',
            'Auto-generate pre-migrate script when XML ID renames are detected (no prompt)'
        )
).action(async (opts) => {
    if (resolveQuiet(opts)) setSilent(true);
    await exportWorkflow(opts);
});

exportCmd.command('rip').action(() => exportRip());

withQuiet(exportCmd.command('pb').option('--no-commit')).action(async (opts) => {
    if (resolveQuiet(opts)) setSilent(true);
    await exportPb(opts);
});

withQuiet(exportCmd.command('imperex').option('--no-commit')).action(async (opts) => {
    if (resolveQuiet(opts)) setSilent(true);
    await exportImperex(opts);
});

withQuiet(exportCmd.command('lrp').option('--no-commit')).action(async (opts) => {
    if (resolveQuiet(opts)) setSilent(true);
    await exportLrp(opts);
});

withQuiet(
    exportCmd
        .command('email-templates')
        .option('--no-commit')
        .option('-b, --bump <level>', 'Version bump level (patch, minor, major)')
        .option('-e, --exclude <value...>', 'exclude templates matching id, name, or template_code')
        .option('-m, --module <name>', 'module directory name (skip prompt)')
        .option('-w, --workflow <value>', 'workflow name or id (skip prompt)')
        .option(
            '--auto-premigrate',
            'Auto-generate pre-migrate script when XML ID renames are detected (no prompt)'
        )
).action(async (opts) => {
    if (resolveQuiet(opts)) setSilent(true);
    await exportEmailTemplates(opts);
});

program.command('routine').action(async () => {
    await routine();
});

program
    .command('update [version]')
    .description('Update the global prbot install (defaults to latest if no version given)')
    .action(async (version) => {
        const target = version ? `@waron97/prbot@${version}` : '@waron97/prbot';
        log(version ? `Updating prbot to ${version}...` : 'Updating prbot to latest...');
        await new Promise((resolve, reject) => {
            execFile('npm', ['i', '-g', target], (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                    return;
                }
                log(stdout);
                log('Done.');
                resolve();
            });
        });
    });

program.parseAsync().catch(fail);
