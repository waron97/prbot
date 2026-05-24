#!/usr/bin/env node
import { createRequire } from 'module';
import { program } from 'commander';
import { init } from './commands/init.js';
import { clone } from './commands/clone.js';
import { pull } from './commands/pull.js';
import { push } from './commands/push.js';
import { diff } from './commands/diff.js';
import { initPhase } from './commands/initPhase.js';
import { repair } from './commands/repair.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

process.on('unhandledRejection', (err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});

program.name('agrippa').version(version);

program
    .command('init')
    .description('Create agrippa.yaml workspace config in the current directory')
    .action(() => init().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); }));

program
    .command('clone')
    .description('Clone a phase or MFA from RIP into this workspace')
    .option('--phase', 'Clone a phase (select a workflow)')
    .option('--mfa', 'Clone a Model Function Access record')
    .option('--id <id>', 'Record ID to clone')
    .option('--path <path>', 'Destination path (file for MFA, base dir for workflow)')
    .action((opts) => clone(opts).catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); }));

program
    .command('pull')
    .description('Pull remote changes into local files')
    .action(() => pull().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); }));

program
    .command('push')
    .description('Push local changes to RIP (backs up remote code first)')
    .action(() => push().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); }));

program
    .command('diff [path]')
    .description('Show differences between local files and remote code')
    .action((path) => diff(path).catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); }));

program
    .command('init-phase')
    .description('Initialize a phase with default code template and result vars')
    .action(() => initPhase().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); }));

program
    .command('repair')
    .description('Remove stale workspace entries where local file no longer exists')
    .action(() => repair().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); }));

program.parse();
