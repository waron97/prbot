import search from '@inquirer/search';
import inquirer from 'inquirer';
import { getToken } from '../../lib/auth.js';
import { loadEffectiveEnv, readConfig, writeConfig } from '../lib/config.js';
import { getLrpXml, listLrps, resolveLrpByName } from '../lib/lrpApi.js';
import { checksumOfPayload, comparePayload, decompose, recompose } from '../lib/pbProject.js';
import { projectReader, writeProject } from '../lib/pbWorkspace.js';

// Clone a long-running process (LRP). Structurally identical to a PB clone
// (same decompose/recompose/checksum machinery — LRPs are plain Activiti BPMN
// too), but selection and identity are name-based: the tabulator `id` changes
// on every save/version bump (verified live — a re-fetched id differs from a
// previously captured one for the same process), so it can never be used as
// a stable workspace key the way PB's guid is.
async function cloneLrp(opts) {
    const config = readConfig();
    loadEffectiveEnv(config);

    if (!process.env.IMPORTEXPORT_URL) {
        throw new Error(
            'IMPORTEXPORT_URL is not configured. Run `prbot init` or set it in agrippa.yaml.'
        );
    }

    const token = await getToken();

    // Selection: by --name (exact) or interactive server-side search (LRPs
    // are searched server-side by name — see listLrps — not fetched-all-then-
    // fuzzy-filtered like PBs).
    let chosen;
    if (opts.name) {
        chosen = await resolveLrpByName(token, opts.name);
    } else {
        console.log('Fetching long-running process list...');
        const initial = await listLrps(token, null);
        let controller = null;
        chosen = await search({
            message: 'Select a long-running process:',
            source: async (input) => {
                if (!input) return initial.map((p) => ({ name: p.name, value: p }));
                if (controller) controller.abort();
                controller = new AbortController();
                try {
                    const list = await listLrps(token, input, controller.signal);
                    return list.map((p) => ({ name: p.name, value: p }));
                } catch {
                    return initial.map((p) => ({ name: p.name, value: p }));
                }
            },
        });
    }

    // Destination directory.
    let dest = opts.path ?? null;
    if (!dest) {
        const { inputPath } = await inquirer.prompt([
            {
                type: 'input',
                name: 'inputPath',
                message: 'Destination directory:',
                default: chosen.name.replace(/^B2WA_/, ''),
            },
        ]);
        dest = inputPath;
    }

    console.log(`Fetching "${chosen.name}"...`);
    const { xml, description } = await getLrpXml(token, chosen.id);
    const payload = { built_page: xml };

    const { files } = decompose(payload);
    writeProject(dest, files);

    const scriptCount = Object.keys(files).filter((p) => p.startsWith('scripts/')).length;
    console.log(`Cloned to ${dest}/  (${scriptCount} script(s)).`);

    // Prove the clone reconstructs the original XML (0-loss bar A). LRPs have
    // no `pages` at all — recompose always synthesizes `pages: []`, which
    // comparePayload (shared with PB, where it's meaningful) would otherwise
    // flag as noise on every single LRP clone.
    const rebuilt = recompose(projectReader(dest));
    const diffs = comparePayload(payload, rebuilt).filter((d) => !d.startsWith('pages:'));
    if (diffs.length) {
        console.warn('WARNING: round-trip verification found differences:');
        diffs.forEach((d) => console.warn('  - ' + d));
    } else {
        console.log('Round-trip verified: recomposed payload is identical (0 information loss).');
    }

    // Register in the workspace for later pull/push — keyed by NAME, not id.
    config.workspace = config.workspace || [];
    const existing = config.workspace.findIndex(
        (e) => e.object_type === 'long_running_process' && e.name === chosen.name
    );
    const entry = {
        path: dest,
        object_type: 'long_running_process',
        name: chosen.name,
        tenant_id: chosen.tenantId,
        svg: chosen.bpmnFileSvg,
        description,
        // Baseline for push classification (see pull.js/push.js): checksum of
        // the *recomposed* payload, changes only when local files change.
        checksum_at_pull: checksumOfPayload(rebuilt),
        version: chosen.version,
        status: chosen.status,
    };
    if (existing >= 0) config.workspace[existing] = entry;
    else config.workspace.push(entry);
    writeConfig(config);
}

export { cloneLrp };
