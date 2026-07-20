import { readFileSync } from 'fs';
import fs from 'fs/promises';
import search from '@inquirer/search';
import inquirer from 'inquirer';
import { resolveAddonsPath } from '../lib/addons.js';
import { fuzzyMatch } from '../lib/fuzzy.js';
import { log } from '../lib/logger.js';

function buildRefString(tridents, jiras, prNumber) {
    const refs = [];

    if (tridents && tridents.length > 0) {
        refs.push(`Trident ${tridents.map((t) => `#${t}`).join(', ')}`);
    }

    if (jiras && jiras.length > 0) {
        refs.push(`JIRA ${jiras.join(', ')}`);
    }

    if (prNumber) {
        refs.push(`PR sorgenia_addons #${prNumber}ADO`);
    }

    return refs.length > 0 ? `(${refs.join(', ')})` : '';
}

function appendPrToLine(line, prNumber) {
    const parenMatch = line.match(/\(([^)]*)\)\s*$/);
    if (parenMatch) {
        const inner = parenMatch[1];
        const suffix = inner.includes('PR sorgenia_addons')
            ? `, #${prNumber}ADO`
            : `, PR sorgenia_addons #${prNumber}ADO`;
        return line.replace(/\(([^)]*)\)\s*$/, `(${inner}${suffix})`);
    }
    return `${line.trimEnd()} (PR sorgenia_addons #${prNumber}ADO)`;
}

function findDuplicateLine(content, tridents, jiras) {
    const lines = content.split('\n');

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
    const lines = content.split('\n');
    const sections = [];

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('### ')) {
            sections.push({
                heading: lines[i],
                startLine: i,
            });
        }
    }

    return sections;
}

function findSectionEndLine(lines, sectionStartLine) {
    const nextSectionLine = lines.findIndex((l, i) => i > sectionStartLine && l.startsWith('### '));

    if (nextSectionLine === -1) {
        return lines.length - 1;
    }

    let endLine = nextSectionLine - 1;
    while (endLine > sectionStartLine && lines[endLine].trim() === '') {
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
    return '  ';
}

async function changelog(prNumber, options) {
    const tridents = options.trident || [];
    const jiras = options.jira || [];
    let message = options.message;

    let ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);
    const changelogPath = `${ADDONS_PATH}/CHANGELOG.md`;

    const content = readFileSync(changelogPath, 'utf-8');

    const duplicate = findDuplicateLine(content, tridents, jiras);
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

    if (appendMode) {
        const lines = content.split('\n');
        lines[duplicate.lineNumber] = appendPrToLine(lines[duplicate.lineNumber], prNumber);
        await fs.writeFile(changelogPath, lines.join('\n'));
        log('Updated existing line');
        return;
    }

    if (!message) {
        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'message',
                message: 'Changelog entry message:',
            },
        ]);
        message = answer.message;
    }

    const sections = extractSections(content);
    const sectionChoices = sections.map((s) => ({
        name: s.heading.replace(/^## /, ''),
        value: s.heading,
    }));

    const selectedSection = await search({
        message: 'Select section to add entry:',
        source: async (input) => {
            if (!input) {
                return sectionChoices;
            }

            return sectionChoices.filter((choice) => fuzzyMatch(choice.name, input));
        },
    });

    const selectedSectionObj = sections.find((s) => s.heading === selectedSection);

    const lines = content.split('\n');
    const endLine = findSectionEndLine(lines, selectedSectionObj.startLine);
    const indent = detectIndentation(lines, selectedSectionObj.startLine, endLine);

    const refString = buildRefString(tridents, jiras, prNumber);
    const newEntry = `${indent}- ${message}${refString ? ' ' + refString : ''}`;

    lines.splice(endLine + 1, 0, newEntry);

    await fs.writeFile(changelogPath, lines.join('\n'));
    log('Changelog entry added');
}

function findLineByPrNumber(content, prNumber) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`#${prNumber}ADO`)) {
            return { lineNumber: i, line: lines[i] };
        }
    }
    return null;
}

function appendRefsToLine(line, tridentIds, jiras) {
    let result = line;

    if (tridentIds && tridentIds.length > 0) {
        const suffix = tridentIds.map((id) => `#${id}`).join(', ');
        const tridentMatch = result.match(/Trident (#[\d, #]+)/);
        if (tridentMatch) {
            const rawCapture = tridentMatch[1];
            const trailing = rawCapture.match(/([,\s]+)$/)?.[1] ?? '';
            const existingTridents = rawCapture.replace(/[,\s]+$/, '');
            result = result.replace(
                /Trident (#[\d, #]+)/,
                `Trident ${existingTridents}, ${suffix}${trailing}`
            );
        } else {
            const parenMatch = result.match(/\(([^)]*)\)\s*$/);
            if (parenMatch) {
                result = result.replace(/\(([^)]*)\)\s*$/, `(Trident ${suffix}, ${parenMatch[1]})`);
            } else {
                result = `${result.trimEnd()} (Trident ${suffix})`;
            }
        }
    }

    if (jiras && jiras.length > 0) {
        const suffix = jiras.join(', ');
        const jiraMatch = result.match(/JIRA ([^,)]+)/);
        if (jiraMatch) {
            result = result.replace(/JIRA ([^,)]+)/, `JIRA ${jiraMatch[1].trimEnd()}, ${suffix}`);
        } else if (result.includes('PR sorgenia_addons')) {
            result = result.replace(/(PR sorgenia_addons)/, `JIRA ${suffix}, $1`);
        } else {
            const parenMatch = result.match(/\(([^)]*)\)\s*$/);
            if (parenMatch) {
                result = result.replace(/\(([^)]*)\)\s*$/, `(${parenMatch[1]}, JIRA ${suffix})`);
            } else {
                result = `${result.trimEnd()} (JIRA ${suffix})`;
            }
        }
    }

    return result;
}

export {
    changelog,
    extractSections,
    findSectionEndLine,
    detectIndentation,
    buildRefString,
    findDuplicateLine,
    appendPrToLine,
    findLineByPrNumber,
    appendRefsToLine,
};
