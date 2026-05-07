import fs from "fs/promises";
import { readFileSync } from "fs";
import inquirer from "inquirer";
import search from "@inquirer/search";
import { resolveAddonsPath } from "../lib/addons.js";

function buildRefString(tridents, jiras, prNumber) {
  const refs = [];

  if (tridents && tridents.length > 0) {
    refs.push(`Trident ${tridents.map((t) => `#${t}`).join(", #")}`);
  }

  if (jiras && jiras.length > 0) {
    refs.push(`JIRA ${jiras.join(", ")}`);
  }

  if (prNumber) {
    refs.push(`PR sorgenia_addons #${prNumber}ADO`);
  }

  return refs.length > 0 ? `(${refs.join(", ")})` : "";
}

function findDuplicateLine(content, tridents, jiras) {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (tridents && tridents.length > 0) {
      for (const t of tridents) {
        if (line.includes(`Trident #${t}`)) {
          return { lineNumber: i, line };
        }
      }
    }

    if (jiras && jiras.length > 0) {
      for (const j of jiras) {
        if (line.includes(j)) {
          return { lineNumber: i, line };
        }
      }
    }
  }

  return null;
}

function extractSections(content) {
  const lines = content.split("\n");
  const sections = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("### ")) {
      sections.push({
        heading: lines[i],
        startLine: i,
      });
    }
  }

  return sections;
}

function findSectionEndLine(lines, sectionStartLine) {
  const nextSectionLine = lines.findIndex(
    (l, i) => i > sectionStartLine && l.startsWith("### "),
  );

  if (nextSectionLine === -1) {
    return lines.length - 1;
  }

  let endLine = nextSectionLine - 1;
  while (endLine > sectionStartLine && lines[endLine].trim() === "") {
    endLine--;
  }

  return endLine;
}

function detectIndentation(lines, sectionStartLine, sectionEndLine) {
  for (let i = sectionStartLine + 1; i <= sectionEndLine; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)-\s/);
    if (match) {
      return match[1];
    }
  }
  return "  ";
}

async function changelog(prNumber, options) {
  const tridents = options.trident || [];
  const jiras = options.jira || [];
  let message = options.message;

  let ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
  const changelogPath = `${ADDONS_PATH}/CHANGELOG.md`;

  const content = readFileSync(changelogPath, "utf-8");

  if (!message) {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "message",
        message: "Changelog entry message:",
      },
    ]);
    message = answer.message;
  }

  const duplicate = findDuplicateLine(content, tridents, jiras);
  if (duplicate) {
    console.log("Found existing line:");
    console.log(duplicate.line);

    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: ["Add PR to existing line", "Create new line"],
      },
    ]);

    if (answer.action === "Add PR to existing line") {
      const refString = buildRefString([], [], prNumber);
      const lines = content.split("\n");
      const line = lines[duplicate.lineNumber];

      let updatedLine;
      const closeParenIndex = line.lastIndexOf(")");
      if (closeParenIndex !== -1) {
        updatedLine =
          line.slice(0, closeParenIndex) +
          `, PR sorgenia_addons #${prNumber}ADO)` +
          line.slice(closeParenIndex + 1);
      } else {
        updatedLine = line + ` (PR sorgenia_addons #${prNumber}ADO)`;
      }

      lines[duplicate.lineNumber] = updatedLine;
      await fs.writeFile(changelogPath, lines.join("\n"));
      console.log("Updated existing line");
      return;
    }
  }

  const sections = extractSections(content);
  const sectionChoices = sections.map((s) => ({
    name: s.heading.replace(/^## /, ""),
    value: s.heading,
  }));

  const selectedSection = await search({
    message: "Select section to add entry:",
    source: async (input) => {
      if (!input) {
        return sectionChoices;
      }

      const filtered = sectionChoices.filter((choice) =>
        choice.name.toLowerCase().includes(input.toLowerCase()),
      );

      return filtered;
    },
  });

  const selectedSectionObj = sections.find(
    (s) => s.heading === selectedSection,
  );

  const lines = content.split("\n");
  const endLine = findSectionEndLine(lines, selectedSectionObj.startLine);
  const indent = detectIndentation(lines, selectedSectionObj.startLine, endLine);

  const refString = buildRefString(tridents, jiras, prNumber);
  const newEntry = `${indent}- ${message}${refString ? " " + refString : ""}`;

  lines.splice(endLine + 1, 0, newEntry);

  await fs.writeFile(changelogPath, lines.join("\n"));
  console.log("Changelog entry added");
}

export { changelog };
