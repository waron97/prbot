import { readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import search from '@inquirer/search';
import inquirer from 'inquirer';
import fetch from 'node-fetch';
import { resolveAddonsPath } from '../lib/addons.js';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { execGit } from '../lib/git.js';
import { log } from '../lib/logger.js';
import { tridentRpc } from '../lib/trident.js';
import {
    appendPrToLine,
    appendRefsToLine,
    buildRefString,
    detectIndentation,
    extractSections,
    findDuplicateLine,
    findLineByPrNumber,
    findSectionEndLine,
} from './changelog.js';

function devopsHeaders() {
    const token = Buffer.from(`:${process.env.DEVOPS_TOKEN}`).toString('base64');
    return {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
    };
}

async function fetchTask(taskId) {
    const result = await tridentRpc('project.task', 'read', [[parseInt(taskId, 10)]], {
        fields: ['name', 'x_subpackage_id', 'x_workflow', 'x_cluster_id', 'x_release_checklist'],
    });
    if (!result || !result[0]) throw new Error(`Task ${taskId} not found`);
    return result[0];
}

function buildPrDescription(taskIds, jiras) {
    const lines = taskIds.map((id) => `${process.env.TRIDENT_URL}/odoo/my-tasks/${id}`);
    for (const jira of jiras ?? []) {
        lines.push(`https://sorgenia.atlassian.net/browse/${jira}`);
    }
    return lines.join('\n');
}

async function fetchActivePr(branch) {
    const { DEVOPS_ORG, DEVOPS_PROJECT, DEVOPS_REPO } = process.env;
    const apiUrl = `https://dev.azure.com/${DEVOPS_ORG}/${DEVOPS_PROJECT}/_apis/git/repositories/${DEVOPS_REPO}/pullrequests?searchCriteria.sourceRefName=refs/heads/${branch}&searchCriteria.status=active&api-version=7.0`;
    const res = await fetch(apiUrl, { headers: devopsHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(`DevOps PR fetch failed: ${JSON.stringify(data)}`);
    if (!data.value || data.value.length === 0)
        throw new Error(`No active PR found for branch: ${branch}`);
    return data.value[0];
}

async function patchDevopsPrDescription(prId, description) {
    const { DEVOPS_ORG, DEVOPS_PROJECT, DEVOPS_REPO } = process.env;
    const apiUrl = `https://dev.azure.com/${DEVOPS_ORG}/${DEVOPS_PROJECT}/_apis/git/repositories/${DEVOPS_REPO}/pullrequests/${prId}?api-version=7.0`;
    const res = await fetch(apiUrl, {
        method: 'PATCH',
        headers: devopsHeaders(),
        body: JSON.stringify({ description }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`DevOps PR patch failed: ${JSON.stringify(data)}`);
}

async function createDevopsPR(branch, title, description) {
    const { DEVOPS_ORG, DEVOPS_PROJECT, DEVOPS_REPO, AUTOPR_TARGET_BRANCH } = process.env;
    const apiUrl = `https://dev.azure.com/${DEVOPS_ORG}/${DEVOPS_PROJECT}/_apis/git/repositories/${DEVOPS_REPO}/pullrequests?api-version=7.0`;
    const reviewers = process.env.AUTOPR_REQUIRED_REVIEWER_ID
        ? [{ id: process.env.AUTOPR_REQUIRED_REVIEWER_ID, isRequired: true }]
        : [];

    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: devopsHeaders(),
        body: JSON.stringify({
            title,
            description,
            isDraft: true,
            sourceRefName: `refs/heads/${branch}`,
            targetRefName: `refs/heads/${AUTOPR_TARGET_BRANCH}`,
            reviewers,
        }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`DevOps PR creation failed: ${JSON.stringify(data)}`);
    const prUrl = `https://dev.azure.com/${DEVOPS_ORG}/${DEVOPS_PROJECT}/_git/${DEVOPS_REPO}/pullrequest/${data.pullRequestId}`;
    return { id: data.pullRequestId, url: prUrl };
}

async function appendChecklistPrLink(taskId, currentChecklist, prUrl) {
    const link = `<a href="${prUrl}">${prUrl}</a><br/>`;
    const updated = currentChecklist ? `${currentChecklist}\n${link}` : link;
    await tridentRpc('project.task', 'write', [
        [parseInt(taskId, 10)],
        { x_release_checklist: updated },
    ]);
}

function scoreSections(sections, candidates) {
    const results = [];
    for (const section of sections) {
        const heading = section.heading.replace(/^### /, '').toLowerCase().trim();
        let score = 0;
        for (const candidate of candidates) {
            const lc = candidate.toLowerCase().trim();
            if (heading === lc) {
                score += 100;
                continue;
            }
            if (heading.includes(lc) || lc.includes(heading)) {
                score += 50;
                continue;
            }
            // Match by first pipe-segment (e.g. "CROSS_31.1 - ML")
            const candidatePrefix = lc.split('|')[0].trim();
            const headingPrefix = heading.split('|')[0].trim();
            if (
                headingPrefix.includes(candidatePrefix) ||
                candidatePrefix.includes(headingPrefix)
            ) {
                score += 20;
                continue;
            }
            // Token fallback
            const tokens = lc.split(/[\s|_\-.]+/).filter((t) => t.length > 1);
            for (const token of tokens) {
                if (heading.includes(token)) {
                    score += /^\d+$/.test(token) ? 5 : 1;
                }
            }
        }
        if (score > 0) results.push({ ...section, score });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

async function selectSection(sections, candidates) {
    const scored = candidates.length > 0 ? scoreSections(sections, candidates) : [];

    if (candidates.length > 0) {
        log(`\nTask fields: ${candidates.join(' | ')}`);
        if (scored.length === 0) log('No matching sections found.');
    }

    const scoredHeadings = new Set(scored.map((s) => s.heading));
    const topChoices = scored.map((s) => ({
        name: `${s.heading.replace(/^### /, '')}  ✓`,
        value: s.heading,
    }));
    const restChoices = sections
        .filter((s) => !scoredHeadings.has(s.heading))
        .map((s) => ({ name: s.heading.replace(/^### /, ''), value: s.heading }));
    const allChoices = [...topChoices, ...restChoices];

    const selected = await search({
        message: 'Select changelog section:',
        source: async (input) => {
            if (!input) return allChoices;
            return allChoices.filter((c) => fuzzyMatch(c.value, input));
        },
    });
    return sections.find((s) => s.heading === selected);
}

async function autoprAmend(options) {
    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const changelogPath = `${ADDONS_PATH}/CHANGELOG.md`;
    const { DEVOPS_ORG, DEVOPS_PROJECT, DEVOPS_REPO } = process.env;

    const branch = (await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], ADDONS_PATH)).trim();
    const pr = await fetchActivePr(branch);
    const prNumber = pr.pullRequestId;
    const prUrl = `https://dev.azure.com/${DEVOPS_ORG}/${DEVOPS_PROJECT}/_git/${DEVOPS_REPO}/pullrequest/${prNumber}`;
    log(`Found PR #${prNumber}: ${prUrl}`);

    const ids = options.trident ?? [];
    const jiras = options.jira ?? [];

    const tasks = ids.length > 0 ? await Promise.all(ids.map(fetchTask)) : [];
    tasks.forEach((t) => log(`Task: ${t.name}`));

    const newLinks = [
        ...ids.map((id) => `${process.env.TRIDENT_URL}/odoo/my-tasks/${id}`),
        ...jiras.map((j) => `https://sorgenia.atlassian.net/browse/${j}`),
    ];
    if (newLinks.length > 0) {
        const updatedDescription = pr.description
            ? `${pr.description}\n${newLinks.join('\n')}`
            : newLinks.join('\n');
        await patchDevopsPrDescription(prNumber, updatedDescription);
        log('PR description updated');
    }

    for (let i = 0; i < ids.length; i++) {
        await appendChecklistPrLink(ids[i], tasks[i].x_release_checklist, prUrl);
    }
    if (ids.length > 0) log('Checklist updated');

    const content = readFileSync(changelogPath, 'utf-8');
    const existing = findLineByPrNumber(content, prNumber);
    if (!existing) {
        log(`Warning: no changelog line found for PR #${prNumber} — skipping changelog update`);
        return;
    }
    const lines = content.split('\n');
    lines[existing.lineNumber] = appendRefsToLine(existing.line, ids, jiras);
    await fs.writeFile(changelogPath, lines.join('\n'));

    await execGit(['add', 'CHANGELOG.md'], ADDONS_PATH);
    await execGit(['commit', '-m', '[DOC][CHANGELOG] Changelog'], ADDONS_PATH);
    await execGit(['push'], ADDONS_PATH);
    log('Changelog updated and pushed');
    log('\nReminder: squash the two changelog commits before merging the PR.');
}

async function autopr(options) {
    if (options.worktree && options.amend) {
        throw new Error(
            '--worktree cannot be combined with --amend (amend operates on the already-checked-out branch)'
        );
    }
    if (options.amend) return autoprAmend(options);

    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const changelogPath = `${ADDONS_PATH}/CHANGELOG.md`;

    const ids = options.trident ?? [];
    const hasTridents = ids.length > 0;

    const tasks = hasTridents ? await Promise.all(ids.map((id) => fetchTask(id))) : [];
    tasks.forEach((t) => log(`Task: ${t.name}`));

    const content = readFileSync(changelogPath, 'utf-8');

    const duplicate = findDuplicateLine(content, ids, options.jira ?? []);

    let appendMode = false;
    if (duplicate) {
        log(`\nExisting entry (line ${duplicate.lineNumber + 1}):\n  ${duplicate.line}`);
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: 'Append PR ref to existing entry?',
                default: true,
            },
        ]);
        appendMode = confirm;
    }

    const branch =
        options.branch ??
        (ids[0] ? `autopr_${ids[0]}` : options.jira?.[0] ? `autopr_${options.jira[0]}` : null);
    if (!branch) throw new Error('No branch name: provide --branch, a task ID, or --jira');

    let message = null;
    if (!appendMode) {
        message = options.message;
        if (!message) {
            const answer = await inquirer.prompt([
                { type: 'input', name: 'message', message: 'Changelog entry message:' },
            ]);
            message = answer.message;
        }
    }

    let repoRoot = ADDONS_PATH;
    if (options.worktree) {
        const worktreePath =
            typeof options.worktree === 'string'
                ? path.resolve(options.worktree)
                : path.join(path.dirname(ADDONS_PATH), `${path.basename(ADDONS_PATH)}-${branch}`);
        await execGit(['worktree', 'add', worktreePath, '-b', branch], ADDONS_PATH);
        log(`Worktree created: ${worktreePath}`);
        repoRoot = worktreePath;
    } else {
        await execGit(['checkout', '-b', branch], ADDONS_PATH);
        log(`Branch created: ${branch}`);
    }
    await execGit(['push', '-u', 'origin', branch], repoRoot);

    const prTitle = options.name ?? tasks[0]?.name ?? branch;
    const prDescription = buildPrDescription(ids, options.jira ?? []);
    const { id: prNumber, url: prUrl } = await createDevopsPR(branch, prTitle, prDescription);
    log(`PR opened: #${prNumber} — ${prUrl}`);

    if (hasTridents) {
        for (let i = 0; i < ids.length; i++) {
            await appendChecklistPrLink(ids[i], tasks[i].x_release_checklist, prUrl);
        }
        log('Checklist updated');
    }

    const lines = content.split('\n');

    if (appendMode) {
        lines[duplicate.lineNumber] = appendPrToLine(lines[duplicate.lineNumber], prNumber);
    } else {
        const sections = extractSections(content);
        const candidates = [];
        if (hasTridents) {
            const anchor = tasks.find(
                (t) =>
                    (Array.isArray(t.x_subpackage_id) && t.x_subpackage_id[1]) ||
                    (Array.isArray(t.x_workflow) && t.x_workflow[1]) ||
                    (Array.isArray(t.x_cluster_id) && t.x_cluster_id[1])
            );
            if (anchor) {
                if (Array.isArray(anchor.x_subpackage_id) && anchor.x_subpackage_id[1])
                    candidates.push(anchor.x_subpackage_id[1]);
                if (Array.isArray(anchor.x_workflow) && anchor.x_workflow[1])
                    candidates.push(anchor.x_workflow[1]);
                if (Array.isArray(anchor.x_cluster_id) && anchor.x_cluster_id[1])
                    candidates.push(anchor.x_cluster_id[1]);
            }
        }

        const selectedSection = await selectSection(sections, candidates);
        const endLine = findSectionEndLine(lines, selectedSection.startLine);
        const indent = detectIndentation(lines, selectedSection.startLine, endLine);

        const jiras = options.jira ?? [];
        const refString = buildRefString(ids, jiras, prNumber);
        const newEntry = `${indent}- ${message}${refString ? ' ' + refString : ''}`;
        lines.splice(endLine + 1, 0, newEntry);
    }

    await fs.writeFile(`${repoRoot}/CHANGELOG.md`, lines.join('\n'));
    log('Changelog entry written');

    await execGit(['add', 'CHANGELOG.md'], repoRoot);
    await execGit(['commit', '-m', '[DOC][CHANGELOG] Changelog'], repoRoot);
    await execGit(['push'], repoRoot);
    log('Changelog committed and pushed');

    if (repoRoot !== ADDONS_PATH) {
        log(`\nContinue working in: ${repoRoot}`);
    }
}

export { autopr };
