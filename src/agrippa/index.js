#!/usr/bin/env node
import { createRequire } from 'module';
import { program } from 'commander';
import { emitJson, error, setJsonMode } from '../lib/logger.js';
import { clone } from './commands/clone.js';
import { diff } from './commands/diff.js';
import { init } from './commands/init.js';
import { initPhase } from './commands/initPhase.js';
import {
    pbAdd,
    pbConnect,
    pbDisconnect,
    pbFormat,
    pbLint,
    pbList,
    pbPreview,
    pbRemove,
    pbSetDefault,
} from './commands/pb.js';
import { pull } from './commands/pull.js';
import { push } from './commands/push.js';
import { repair } from './commands/repair.js';
import { restore } from './commands/restore.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

process.on('unhandledRejection', (err) => {
    error(`Error: ${err.message}`);
    process.exit(1);
});

// Shared failure handler for commands with a `--json` option: on error, emit
// a `{ ok: false, error }` payload to stdout (so a --json caller always gets
// parseable stdout, even on failure) in addition to the usual stderr line.
function failCommand(opts) {
    return (err) => {
        if (opts.json) emitJson({ ok: false, error: err.message });
        error(`Error: ${err.message}`);
        process.exit(1);
    };
}

program.name('agrippa').version(version);

program.option(
    '--secrets-file <path>',
    'Load KC_*/RIP_URL/PB_URL from this dotenv file (highest priority; falls back to ' +
        '~/.config/prbot/config per key)'
);

program
    .command('init')
    .description('Create agrippa.yaml workspace config in the current directory')
    .action(() =>
        init().catch((err) => {
            error(`Error: ${err.message}`);
            process.exit(1);
        })
    );

program
    .command('clone')
    .description(
        'Clone a phase, MFA, process-builder wizard, or long-running process into this workspace'
    )
    .option('--phase', 'Clone a phase (select a workflow)')
    .option('--mfa', 'Clone a Model Function Access record')
    .option('--pb', 'Clone a process-builder wizard')
    .option('--lrp', 'Clone a long-running process')
    .option('--id <id>', 'Record ID to clone (phase/mfa)')
    .option(
        '--name <name>',
        'Name to clone by (workflow name, MFA name, document_id for --pb, or process name for --lrp)'
    )
    .option('--path <path>', 'Destination path (file for MFA, base dir for workflow/pb/lrp)')
    .option(
        '-l, --list',
        'List matching records instead of cloning (requires --phase, --mfa, --pb, or --lrp)'
    )
    .option('-Q, --query <text>', 'Fuzzy-filter the list (used with --list)')
    .action((opts) =>
        clone({ ...opts, secretsFile: program.opts().secretsFile }).catch((err) => {
            error(`Error: ${err.message}`);
            process.exit(1);
        })
    );

program
    .command('pull')
    .description('Pull remote changes into local files')
    .option(
        '--non-interactive',
        'No prompts; auto-select safe (fast-forward) entries and fail if any is in conflict'
    )
    .action((opts) =>
        pull({ ...opts, secretsFile: program.opts().secretsFile }).catch((err) => {
            error(`Error: ${err.message}`);
            process.exit(1);
        })
    );

program
    .command('push')
    .description('Push local changes to RIP / Process Builder / LRP (backs up remote first)')
    .option('--publish', 'Auto-publish pushed wizards and auto-deploy pushed LRPs')
    .option('--skip-publish', 'Skip publishing/deploying pushed wizards and LRPs (no prompt)')
    .option(
        '--non-interactive',
        'No prompts; auto-select safe (fast-forward) entries and fail if any is in conflict'
    )
    .option('--json', 'Emit a single JSON result object to stdout instead of human logs')
    .action((opts) => {
        opts.secretsFile = program.opts().secretsFile;
        if (opts.json) {
            setJsonMode(true);
            opts.nonInteractive = true; // --json can't coexist with interactive prompts
        }
        push(opts).catch(failCommand(opts));
    });

program
    .command('restore')
    .description('Restore local files from a .backup/ snapshot (phase/mfa code, pb/lrp projects)')
    .option('--timestamp <ts>', 'Backup snapshot to restore from (skips the snapshot picker)')
    .action((opts) =>
        restore(opts).catch((err) => {
            error(`Error: ${err.message}`);
            process.exit(1);
        })
    );

program
    .command('diff [target]')
    .description(
        'Show differences between local files and remote code. [target] = file, folder, ' +
            'project dir, document_id or name; omit for the whole workspace'
    )
    .option('--json', 'Emit a single JSON result object to stdout instead of human logs')
    .action((target, opts) => {
        opts.secretsFile = program.opts().secretsFile;
        if (opts.json) setJsonMode(true);
        diff(target, opts).catch(failCommand(opts));
    });

program
    .command('init-phase')
    .description('Initialize a phase with default code template and result vars')
    .action((opts) =>
        initPhase({ ...opts, secretsFile: program.opts().secretsFile }).catch((err) => {
            error(`Error: ${err.message}`);
            process.exit(1);
        })
    );

program
    .command('repair')
    .description('Remove stale workspace entries where local file no longer exists')
    .action(() =>
        repair().catch((err) => {
            error(`Error: ${err.message}`);
            process.exit(1);
        })
    );

// ---- pb: local editing helpers for a cloned process-builder wizard or LRP ----
const die = (err) => {
    error(`Error: ${err.message}`);
    process.exit(1);
};
const pb = program
    .command('pb')
    .description(
        'Edit a cloned process-builder wizard or long-running process (local; run `pb format` after edits)'
    );

pb.command('format')
    .description('Auto-lay-out the diagram (left→right) and rewrite geometry')
    .option('--pb <document_id_or_name>', 'Target wizard/LRP (else single-entry / fuzzy prompt)')
    .action((opts) => pbFormat(opts).catch(die));

pb.command('add')
    .description('Add a node (scaffolds script/page); stub geometry, run format after')
    .requiredOption(
        '--type <type>',
        'Node type: scriptTask|serviceTask|userTask|exclusiveGateway|subProcess|transaction|' +
            'startEvent|endEvent|boundaryEvent|intermediateCatchEvent|intermediateThrowEvent|' +
            'callActivity|parallelGateway|eventBasedGateway (userTask is process-builder only)'
    )
    .option('--name <name>', 'Node name')
    .option('--parent <id>', 'Place inside this subProcess/transaction')
    .option(
        '--from <id>',
        'Insert between two already-connected nodes: source id (requires --to; ' +
            'exactly one edge must already run --from → --to)'
    )
    .option('--to <id>', 'Insert between two already-connected nodes: target id (requires --from)')
    .option('--pb <document_id_or_name>', 'Target wizard/LRP')
    .action((opts) => pbAdd(opts).catch(die));

pb.command('rm')
    .description(
        'Remove a node and its contained nodes, their incoming/outgoing edges, ' +
            'attached boundary events, and their script/page files and manifest entries'
    )
    .requiredOption('--id <id>', 'Node id to remove')
    .option('--pb <document_id_or_name>', 'Target wizard/LRP')
    .action((opts) => pbRemove(opts).catch(die));

pb.command('connect')
    .description('Add a sequenceFlow between two nodes')
    .requiredOption('--from <id>', 'Source node id')
    .requiredOption('--to <id>', 'Target node id')
    .option('--name <name>', 'Flow name (label)')
    .option('--condition <expr>', 'Condition expression, e.g. ${isAlive}')
    .option('--condition-type <type>', 'xsi:type for the condition (default tFormalExpression)')
    .option('--default', 'Mark this as the source gateway default flow')
    .option('--pb <document_id_or_name>', 'Target wizard/LRP')
    .action((opts) => pbConnect(opts).catch(die));

pb.command('disconnect')
    .description('Remove a sequenceFlow by id, or by --from/--to')
    .option('--id <id>', 'Edge id to remove')
    .option('--from <id>', 'Source node id')
    .option('--to <id>', 'Target node id')
    .option('--pb <document_id_or_name>', 'Target wizard/LRP')
    .action((opts) => pbDisconnect(opts).catch(die));

pb.command('set-default')
    .description("Mark an existing flow as the source gateway's default (by --id or --from/--to)")
    .option('--id <id>', 'Edge id to mark default')
    .option('--from <id>', 'Source gateway id')
    .option('--to <id>', 'Target node id')
    .option('--pb <document_id_or_name>', 'Target wizard/LRP')
    .action((opts) => pbSetDefault(opts).catch(die));

pb.command('lint')
    .description(
        'Check diagram for structural issues (edge names, incoming-edge rules, gateway rules)'
    )
    .option('--pb <document_id_or_name>', 'Target wizard/LRP')
    .action((opts) => pbLint(opts).catch(die));

pb.command('ls')
    .description('List nodes and edges (discover ids without reading the YAML)')
    .option('--pb <document_id_or_name>', 'Target wizard/LRP')
    .action((opts) => pbList(opts).catch(die));

pb.command('preview')
    .description('Render the diagram to an SVG (dev check of format output)')
    .option('--out <file>', 'Output path (default <project>/preview.svg)')
    .option('--pb <document_id_or_name>', 'Target wizard/LRP')
    .action((opts) => pbPreview(opts).catch(die));

program.parse();
