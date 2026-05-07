import fs from "fs/promises";
import { readFileSync } from "fs";
import fetch from "node-fetch";
import inquirer from "inquirer";
import search from "@inquirer/search";
import { resolveAddonsPath } from "../lib/addons.js";
import { execGit } from "../lib/git.js";
import {
  extractSections,
  findSectionEndLine,
  detectIndentation,
  buildRefString,
  findDuplicateLine,
  appendPrToLine,
} from "./changelog.js";

function devopsHeaders() {
  const token = Buffer.from(`:${process.env.DEVOPS_TOKEN}`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    "Content-Type": "application/json",
  };
}

async function fetchTask(taskId) {
  const url = `${process.env.TRIDENT_URL}/jsonrpc`;
  const body = {
    jsonrpc: "2.0",
    method: "call",
    id: 1,
    params: {
      service: "object",
      method: "execute_kw",
      args: [
        process.env.TRIDENT_DB,
        parseInt(process.env.TRIDENT_UID, 10),
        process.env.TRIDENT_TOKEN,
        "project.task",
        "read",
        [[parseInt(taskId, 10)]],
        {
          fields: [
            "name",
            "x_subpackage_id",
            "x_workflow",
            "x_release_checklist",
          ],
        },
      ],
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error)
    throw new Error(`Trident error: ${JSON.stringify(data.error)}`);
  if (!data.result || !data.result[0])
    throw new Error(`Task ${taskId} not found`);
  return data.result[0];
}

function buildPrDescription(taskIds, jiras) {
  const lines = taskIds.map(
    (id) => `${process.env.TRIDENT_URL}/odoo/my-tasks/${id}`,
  );
  for (const jira of jiras ?? []) {
    lines.push(`https://sorgenia.atlassian.net/browse/${jira}`);
  }
  return lines.join("\n");
}

async function createDevopsPR(branch, title, description) {
  const { DEVOPS_ORG, DEVOPS_PROJECT, DEVOPS_REPO, AUTOPR_TARGET_BRANCH } =
    process.env;
  const apiUrl = `https://dev.azure.com/${DEVOPS_ORG}/${DEVOPS_PROJECT}/_apis/git/repositories/${DEVOPS_REPO}/pullrequests?api-version=7.0`;
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: devopsHeaders(),
    body: JSON.stringify({
      title,
      description,
      isDraft: true,
      sourceRefName: `refs/heads/${branch}`,
      targetRefName: `refs/heads/${AUTOPR_TARGET_BRANCH}`,
    }),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(`DevOps PR creation failed: ${JSON.stringify(data)}`);
  const prUrl = `https://dev.azure.com/${DEVOPS_ORG}/${DEVOPS_PROJECT}/_git/${DEVOPS_REPO}/pullrequest/${data.pullRequestId}`;
  return { id: data.pullRequestId, url: prUrl };
}

async function appendChecklistPrLink(taskId, currentChecklist, prUrl, prNumber) {
  const link = `<a href="${prUrl}">${prUrl}</a><br/>`;
  const updated = currentChecklist ? `${currentChecklist}\n${link}` : link;
  const url = `${process.env.TRIDENT_URL}/jsonrpc`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      id: 2,
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          process.env.TRIDENT_DB,
          parseInt(process.env.TRIDENT_UID, 10),
          process.env.TRIDENT_TOKEN,
          "project.task",
          "write",
          [[parseInt(taskId, 10)], { x_release_checklist: updated }],
        ],
      },
    }),
  });
  const data = await res.json();
  if (data.error)
    throw new Error(`Trident write error: ${JSON.stringify(data.error)}`);
}

function scoreSections(sections, candidates) {
  const results = [];
  for (const section of sections) {
    const heading = section.heading.replace(/^### /, "").toLowerCase().trim();
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
      const candidatePrefix = lc.split("|")[0].trim();
      const headingPrefix = heading.split("|")[0].trim();
      if (
        headingPrefix.includes(candidatePrefix) ||
        candidatePrefix.includes(headingPrefix)
      ) {
        score += 20;
        continue;
      }
      // Token fallback
      const tokens = lc
        .split(/[\s|_\-.]+/)
        .filter((t) => t.length > 2);
      for (const token of tokens) {
        if (heading.includes(token)) score++;
      }
    }
    if (score > 0) results.push({ ...section, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

async function selectSection(sections, candidates) {
  const scored = candidates.length > 0 ? scoreSections(sections, candidates) : [];

  if (candidates.length > 0) {
    console.log(`\nTask fields: ${candidates.join(" | ")}`);
    if (scored.length === 0) console.log("No matching sections found.");
  }

  const scoredHeadings = new Set(scored.map((s) => s.heading));
  const topChoices = scored.map((s) => ({
    name: `${s.heading.replace(/^### /, "")}  ✓`,
    value: s.heading,
  }));
  const restChoices = sections
    .filter((s) => !scoredHeadings.has(s.heading))
    .map((s) => ({ name: s.heading.replace(/^### /, ""), value: s.heading }));
  const allChoices = [...topChoices, ...restChoices];

  const selected = await search({
    message: "Select changelog section:",
    source: async (input) => {
      if (!input) return allChoices;
      return allChoices.filter((c) =>
        c.value.toLowerCase().includes(input.toLowerCase()),
      );
    },
  });
  return sections.find((s) => s.heading === selected);
}

async function autopr(options) {
  const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
  const changelogPath = `${ADDONS_PATH}/CHANGELOG.md`;

  const ids = options.trident ?? [];
  const hasTridents = ids.length > 0;

  const tasks = hasTridents
    ? await Promise.all(ids.map((id) => fetchTask(id)))
    : [];
  tasks.forEach((t) => console.log(`Task: ${t.name}`));

  const content = readFileSync(changelogPath, "utf-8");

  const duplicate = hasTridents
    ? findDuplicateLine(content, ids, [])
    : null;

  let appendMode = false;
  if (duplicate) {
    console.log(`\nExisting entry (line ${duplicate.lineNumber + 1}):\n  ${duplicate.line}`);
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: "Append PR ref to existing entry?",
        default: true,
      },
    ]);
    appendMode = confirm;
  }

  const branch =
    options.branch ??
    (ids[0]
      ? `autopr_${ids[0]}`
      : options.jira?.[0]
        ? `autopr_${options.jira[0]}`
        : null);
  if (!branch)
    throw new Error(
      "No branch name: provide --branch, a task ID, or --jira",
    );

  let message = null;
  if (!appendMode) {
    message = options.message;
    if (!message) {
      const answer = await inquirer.prompt([
        { type: "input", name: "message", message: "Changelog entry message:" },
      ]);
      message = answer.message;
    }
  }

  await execGit(["checkout", "-b", branch], ADDONS_PATH);
  console.log(`Branch created: ${branch}`);
  await execGit(["push", "-u", "origin", branch], ADDONS_PATH);

  const prTitle = options.name ?? (tasks[0]?.name ?? branch);
  const prDescription = buildPrDescription(ids, options.jira ?? []);
  const { id: prNumber, url: prUrl } = await createDevopsPR(branch, prTitle, prDescription);
  console.log(`PR opened: #${prNumber} — ${prUrl}`);

  if (hasTridents) {
    for (let i = 0; i < ids.length; i++) {
      await appendChecklistPrLink(ids[i], tasks[i].x_release_checklist, prUrl, prNumber);
    }
    console.log("Checklist updated");
  }

  const lines = content.split("\n");

  if (appendMode) {
    lines[duplicate.lineNumber] = appendPrToLine(lines[duplicate.lineNumber], prNumber);
  } else {
    const sections = extractSections(content);
    const candidates = [];
    if (hasTridents) {
      const anchor = tasks.find(
        (t) =>
          (Array.isArray(t.x_subpackage_id) && t.x_subpackage_id[1]) ||
          (Array.isArray(t.x_workflow) && t.x_workflow[1]),
      );
      if (anchor) {
        if (Array.isArray(anchor.x_subpackage_id) && anchor.x_subpackage_id[1])
          candidates.push(anchor.x_subpackage_id[1]);
        if (Array.isArray(anchor.x_workflow) && anchor.x_workflow[1])
          candidates.push(anchor.x_workflow[1]);
      }
    }

    const selectedSection = await selectSection(sections, candidates);
    const endLine = findSectionEndLine(lines, selectedSection.startLine);
    const indent = detectIndentation(lines, selectedSection.startLine, endLine);

    const jiras = options.jira ?? [];
    const refString = buildRefString(ids, jiras, prNumber);
    const newEntry = `${indent}- ${message}${refString ? " " + refString : ""}`;
    lines.splice(endLine + 1, 0, newEntry);
  }

  await fs.writeFile(changelogPath, lines.join("\n"));
  console.log("Changelog entry written");

  await execGit(["add", "CHANGELOG.md"], ADDONS_PATH);
  await execGit(
    ["commit", "-m", "[DOC][CHANGELOG] Changelog"],
    ADDONS_PATH,
  );
  await execGit(["push"], ADDONS_PATH);
  console.log("Changelog committed and pushed");
}

export { autopr };
