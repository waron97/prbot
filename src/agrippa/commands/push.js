import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import inquirer from 'inquirer';
import { getToken } from '../../lib/auth.js';
import { updateMfa, updatePhase } from '../lib/api.js';
import { computeChecksum } from '../lib/checksum.js';
import { loadEffectiveEnv, readConfig, writeConfig } from '../lib/config.js';
import { fetchUpstream } from '../lib/lrpApi.js';
import { getProcess } from '../lib/pbApi.js';
import { localChecksum, remoteChecksumPb } from '../lib/pbProject.js';
import { projectReader } from '../lib/pbWorkspace.js';
import { fileExists, readCodeFile } from '../lib/workspace.js';
import { fetchRemoteCode, selectEntries } from './pull.js';
import { deploy, pushLrpEntry } from './pushLrp.js';
import { publish, pushPbEntry } from './pushPb.js';

const BACKUP_DIR = '.backup';

async function push(opts = {}) {
    const config = readConfig();
    loadEffectiveEnv(config);

    // Stale-entry check (a path may be a file for phase/mfa or a dir for pb).
    const stale = config.workspace.filter((e) => !fileExists(e.path));
    if (stale.length) {
        console.log('\nThe following tracked resources no longer exist on disk:');
        stale.forEach((e) => console.log(`  - ${e.path}  (${e.name})`));
        const { cleanup } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'cleanup',
                message: 'Remove these entries from the workspace config?',
                default: true,
            },
        ]);
        if (cleanup) {
            config.workspace = config.workspace.filter((e) => fileExists(e.path));
            writeConfig(config);
        }
    }

    if (!config.workspace.length) {
        console.log('No tracked resources. Run `agrippa clone` first.');
        return;
    }

    const hasCode = config.workspace.some(
        (e) => e.object_type === 'phase' || e.object_type === 'mfa'
    );
    const hasPb = config.workspace.some((e) => e.object_type === 'process_builder');
    const hasLrp = config.workspace.some((e) => e.object_type === 'long_running_process');
    const ripUrl = process.env.RIP_URL;
    if (hasCode && !ripUrl)
        throw new Error('RIP_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');
    if (hasPb && !process.env.PB_URL)
        throw new Error('PB_URL is not configured. Run `prbot init` or set it in agrippa.yaml.');
    if (hasLrp && !process.env.IMPORTEXPORT_URL)
        throw new Error(
            'IMPORTEXPORT_URL is not configured. Run `prbot init` or set it in agrippa.yaml.'
        );

    console.log('Fetching remote state...');
    const token = await getToken();

    const remoteCodeMap = hasCode
        ? await fetchRemoteCode(token, ripUrl, config.workspace)
        : new Map();
    const upstreamMap = new Map();
    for (const e of config.workspace.filter((x) => x.object_type === 'process_builder')) {
        try {
            upstreamMap.set(e.guid, await getProcess(token, e.guid));
        } catch {
            upstreamMap.set(e.guid, null);
        }
    }
    const lrpUpstreamMap = new Map();
    for (const e of config.workspace.filter((x) => x.object_type === 'long_running_process')) {
        try {
            lrpUpstreamMap.set(e.name, await fetchUpstream(token, e.name));
        } catch {
            lrpUpstreamMap.set(e.name, null);
        }
    }

    // Classify every entry to a status badge — concern: overwriting remote work.
    const classified = config.workspace.map((entry) => {
        if (entry.object_type === 'process_builder') {
            const upstream = upstreamMap.get(entry.guid) ?? null;
            const localSemantic = localChecksum(projectReader(entry.path));
            const remoteSemantic = upstream ? remoteChecksumPb(upstream) : null;
            const pullChecksum = entry.checksum_at_pull;
            let status;
            if (localSemantic === remoteSemantic) status = 'unchanged';
            else if (pullChecksum === remoteSemantic) status = 'fast-forward';
            else status = 'conflict';
            return { ...entry, upstream, status };
        }

        if (entry.object_type === 'long_running_process') {
            const upstream = lrpUpstreamMap.get(entry.name) ?? null;
            const localSemantic = localChecksum(projectReader(entry.path));
            const remoteSemantic = upstream ? remoteChecksumPb(upstream.payload) : null;
            const pullChecksum = entry.checksum_at_pull;
            let status;
            if (localSemantic === remoteSemantic) status = 'unchanged';
            else if (pullChecksum === remoteSemantic) status = 'fast-forward';
            else status = 'conflict';
            return { ...entry, upstream, status };
        }

        const key = `${entry.object_type}:${entry.id}`;
        const remoteCode = remoteCodeMap.get(key) ?? null;
        const localCode = readCodeFile(entry.path);
        const remoteChecksum = computeChecksum(remoteCode ?? '');
        const localChecksumVal = computeChecksum(localCode ?? '');
        const pullChecksum = entry.checksum_at_pull;
        let status;
        if (localChecksumVal === remoteChecksum) status = 'unchanged';
        else if (pullChecksum === remoteChecksum) status = 'fast-forward';
        else status = 'conflict';
        return { ...entry, remoteCode, localCode, status };
    });

    const changed = classified.filter((e) => e.status !== 'unchanged');
    if (!changed.length) {
        console.log('Nothing to push — everything matches the last-pulled state.');
        return;
    }

    const selected = await selectEntries(changed, 'push (overwrites remote)', 'push');
    if (!selected.length) {
        console.log('Nothing selected. No changes made.');
        return;
    }

    const backupTs = new Date().toISOString().replace(/:/g, '-').replace('T', '_').slice(0, 19);

    // Back up remote code for phase/mfa before overwriting (pb/lrp back up
    // their own full upstream payload inside pushPbEntry/pushLrpEntry).
    for (const entry of selected) {
        if (
            entry.object_type !== 'process_builder' &&
            entry.object_type !== 'long_running_process' &&
            entry.remoteCode != null
        ) {
            const backupPath = join(BACKUP_DIR, backupTs, entry.path);
            mkdirSync(dirname(backupPath), { recursive: true });
            writeFileSync(backupPath, (entry.remoteCode ?? '').trim() + '\n', 'utf-8');
        }
    }

    const pushedPb = [];
    const pushedLrp = [];
    let pushed = 0;
    for (const entry of selected) {
        const idx = config.workspace.findIndex((e) => {
            if (e.object_type !== entry.object_type) return false;
            if (entry.object_type === 'process_builder') return e.guid === entry.guid;
            if (entry.object_type === 'long_running_process') return e.name === entry.name;
            return e.id === entry.id;
        });

        if (entry.object_type === 'process_builder') {
            const res = await pushPbEntry(token, entry, BACKUP_DIR, backupTs);
            const note = [
                res.created && `${res.created} new page(s)`,
                res.updated && `${res.updated} page(s) updated`,
            ]
                .filter(Boolean)
                .join(', ');
            console.log(`  ${entry.name} → saved (draft)${note ? ` [${note}]` : ''}`);
            if (idx !== -1) {
                config.workspace[idx].checksum_at_pull = res.newChecksum;
                if (res.newUpdatedDate) config.workspace[idx].updated_date = res.newUpdatedDate;
                config.workspace[idx].status = res.newStatus || 'draft';
            }
            pushedPb.push({ entry, idx });
        } else if (entry.object_type === 'long_running_process') {
            const res = await pushLrpEntry(token, entry, BACKUP_DIR, backupTs);
            console.log(`  ${entry.name} → saved`);
            if (idx !== -1) {
                config.workspace[idx].checksum_at_pull = res.newChecksum;
                config.workspace[idx].tenant_id = res.newRow.tenantId;
                config.workspace[idx].description = res.newRow.description;
                config.workspace[idx].version = res.newRow.version;
                config.workspace[idx].status = res.newRow.status;
            }
            // deployBpmn's expected id (fresh save response vs the pre-save row)
            // isn't verified live yet — see pushLrp.js.
            pushedLrp.push({ entry, idx, deployId: res.saved?.id ?? res.newRow.id });
        } else {
            const code = entry.localCode ?? '';
            if (entry.object_type === 'phase') await updatePhase(token, ripUrl, entry.id, code);
            else await updateMfa(token, ripUrl, entry.id, code);
            if (idx !== -1) config.workspace[idx].checksum_at_pull = computeChecksum(code);
        }
        pushed++;
    }

    console.log(`\nRemote backups written to ${BACKUP_DIR}/${backupTs}/`);

    // Publish/deploy step for pushed wizards and LRPs.
    if (pushedPb.length) {
        await handlePublish(token, pushedPb, config, opts);
    }
    if (pushedLrp.length) {
        await handleDeploy(token, pushedLrp, config, opts);
    }

    writeConfig(config);
    console.log(`\nPushed ${pushed} record(s).`);
}

async function handlePublish(token, pushedPb, config, opts) {
    for (const { entry, idx } of pushedPb) {
        let doPublish;
        if (opts.skipPublish) doPublish = false;
        else if (opts.publish) doPublish = true;
        else {
            ({ doPublish } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'doPublish',
                    message: `Publish "${entry.name}" now?`,
                    default: false,
                },
            ]));
        }
        if (doPublish) {
            await publish(token, entry.guid);
            if (idx !== -1) config.workspace[idx].status = 'published';
            console.log(`  published ${entry.name}`);
        }
    }
}

async function handleDeploy(token, pushedLrp, config, opts) {
    for (const { entry, idx, deployId } of pushedLrp) {
        let doDeploy;
        if (opts.skipPublish) doDeploy = false;
        else if (opts.publish) doDeploy = true;
        else {
            ({ doDeploy } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'doDeploy',
                    message: `Deploy "${entry.name}" now?`,
                    default: false,
                },
            ]));
        }
        if (doDeploy) {
            await deploy(token, deployId);
            if (idx !== -1) config.workspace[idx].status = 'deployed';
            console.log(`  deployed ${entry.name}`);
        }
    }
}

export { push };
