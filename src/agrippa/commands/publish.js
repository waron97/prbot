import inquirer from 'inquirer';
import { getToken } from '../../lib/auth.js';
import { emitJson, log } from '../../lib/logger.js';
import { loadEffectiveEnv, readConfig, writeConfig } from '../lib/config.js';
import { resolveLrpByName } from '../lib/lrpApi.js';
import { filterEntries } from './diff.js';
import { deploy } from './pushLrp.js';
import { publish as publishWizard } from './pushPb.js';

const PUBLISHABLE_TYPES = new Set(['process_builder', 'long_running_process']);

async function publish(targetArg, opts = {}) {
    const config = readConfig();
    loadEffectiveEnv(config, opts.secretsFile);

    const candidates = filterEntries(config.workspace, targetArg).filter((e) =>
        PUBLISHABLE_TYPES.has(e.object_type)
    );
    if (!candidates.length) {
        if (opts.json) emitJson({ ok: true, results: [] });
        else
            log('No publishable resources (process-builder wizard or long-running process) match.');
        return;
    }

    const hasPb = candidates.some((e) => e.object_type === 'process_builder');
    const hasLrp = candidates.some((e) => e.object_type === 'long_running_process');
    if (hasPb && !process.env.PB_URL)
        throw new Error('PB_URL is not configured. Run `prbot init` or pass --secrets-file.');
    if (hasLrp && !process.env.IMPORTEXPORT_URL)
        throw new Error(
            'IMPORTEXPORT_URL is not configured. Run `prbot init` or pass --secrets-file.'
        );

    let selected;
    if (opts.all) {
        selected = candidates;
    } else if (opts.nonInteractive) {
        if (!targetArg && !opts.all) {
            throw new Error(
                'Nothing to publish: pass a target or --all in non-interactive mode ' +
                    '(no stdin to prompt on).'
            );
        }
        selected = candidates;
    } else {
        const choices = candidates.map((e) => ({
            name: `${e.name}  [${e.object_type === 'process_builder' ? 'wizard' : 'LRP'} · ${e.status ?? 'unknown'}]`,
            value: e,
            checked: true,
        }));
        ({ selected } = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'selected',
                message: 'Select records to publish/deploy:',
                choices,
                pageSize: 20,
            },
        ]));
    }

    if (!selected.length) {
        if (opts.json) emitJson({ ok: true, results: [] });
        else log('Nothing selected. No changes made.');
        return;
    }

    const token = await getToken();
    const results = [];

    for (const entry of selected) {
        if (entry.object_type === 'process_builder') {
            await publishWizard(token, entry.guid);
            const idx = config.workspace.findIndex(
                (e) => e.object_type === 'process_builder' && e.guid === entry.guid
            );
            if (idx !== -1) config.workspace[idx].status = 'published';
            writeConfig(config);
            log(`  published ${entry.name}`);
            results.push({ name: entry.name, type: entry.object_type, status: 'published' });
        } else {
            const row = await resolveLrpByName(token, entry.name);
            await deploy(token, row.id);
            const idx = config.workspace.findIndex(
                (e) => e.object_type === 'long_running_process' && e.name === entry.name
            );
            if (idx !== -1) {
                config.workspace[idx].status = 'deployed';
                config.workspace[idx].version = row.version;
            }
            writeConfig(config);
            log(`  deployed ${entry.name}`);
            results.push({ name: entry.name, type: entry.object_type, status: 'deployed' });
        }
    }

    log(`\nPublished/deployed ${results.length} record(s).`);
    if (opts.json) emitJson({ ok: true, results });
}

export { publish };
