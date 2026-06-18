import search from '@inquirer/search';
import inquirer from 'inquirer';
import { getToken } from '../../lib/auth.js';
import { fuzzyMatch } from '../../lib/fuzzy.js';
import { computeChecksum } from '../lib/checksum.js';
import { loadEffectiveEnv, readConfig, writeConfig } from '../lib/config.js';
import { getProcess, listProcesses } from '../lib/pbApi.js';
import { comparePayload, decompose, recompose, stableStringify } from '../lib/pbProject.js';
import { projectReader, writeProject } from '../lib/pbWorkspace.js';

async function clonePb(opts) {
    const config = readConfig();
    loadEffectiveEnv(config);

    if (!process.env.PB_URL) {
        throw new Error('PB_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');
    }

    console.log('Fetching process list...');
    const token = await getToken();
    const processes = await listProcesses(token);
    if (!processes.length) {
        console.log('No process-builder wizards found.');
        return;
    }

    // Select the process: by --name (document_id) or interactive fuzzy search.
    let chosen;
    if (opts.name) {
        chosen = processes.find((p) => p.document_id === opts.name);
        if (!chosen) throw new Error(`No process found with document_id "${opts.name}"`);
    } else {
        chosen = await search({
            message: 'Select a process-builder wizard:',
            source: (input) => {
                const list = input
                    ? processes.filter(
                          (p) =>
                              fuzzyMatch(p.process_name, input) || fuzzyMatch(p.document_id, input)
                      )
                    : processes;
                return list.map((p) => ({
                    name: `${p.process_name}  (${p.document_id})`,
                    value: p,
                }));
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
                default: chosen.document_id,
            },
        ]);
        dest = inputPath;
    }

    console.log(`Fetching "${chosen.process_name}"...`);
    const payload = await getProcess(token, chosen.guid);

    const { files } = decompose(payload);
    writeProject(dest, files);

    const scriptCount = Object.keys(files).filter((p) => p.startsWith('scripts/')).length;
    const pageCount = Object.keys(files).filter((p) => p.startsWith('pages/')).length;
    console.log(`Cloned to ${dest}/  (${scriptCount} script(s), ${pageCount} page(s))`);

    // Prove the clone reconstructs the original payload (0-loss bar A) by
    // reading the files back from disk and recomposing.
    const rebuilt = recompose(projectReader(dest));
    const diffs = comparePayload(payload, rebuilt);
    if (diffs.length) {
        console.warn('WARNING: round-trip verification found differences:');
        diffs.forEach((d) => console.warn('  - ' + d));
    } else {
        console.log('Round-trip verified: recomposed payload is identical (0 information loss).');
    }

    // Register in the workspace for later pull/push.
    config.workspace = config.workspace || [];
    const existing = config.workspace.findIndex(
        (e) => e.object_type === 'process_builder' && e.guid === chosen.guid
    );
    const entry = {
        path: dest,
        object_type: 'process_builder',
        guid: chosen.guid,
        document_id: chosen.document_id,
        name: chosen.process_name,
        // Baselines for `push` classification: checksum of the *recomposed* payload
        // (changes only when local files change) + upstream updated_date/status.
        checksum_at_pull: computeChecksum(stableStringify(rebuilt)),
        updated_date: payload.updated_date,
        status: payload.status,
    };
    if (existing >= 0) config.workspace[existing] = entry;
    else config.workspace.push(entry);
    writeConfig(config);
}

export { clonePb };
