import chalk from 'chalk';
import inquirer from 'inquirer';
import searchList from 'inquirer-search-list';
import { resolveAddonsPath } from '../lib/addons.js';
import { execGit } from '../lib/git.js';

inquirer.registerPrompt('search-list', searchList);

const commitOperations = [
    {
        name: `✅ ADD ${chalk.gray('- Adding something that was previously missing')}`,
        value: '[ADD]',
    },
    { name: `📖 DOC ${chalk.gray('- Documentation changes')}`, value: '[DOC]' },
    { name: `🩹 FIX ${chalk.gray('- Bugfix or hotfix')}`, value: '[FIX]' },
    { name: `🛠️ IMP ${chalk.gray('- Improvement of existing code')}`, value: '[IMP]' },
    { name: `💬 I18N ${chalk.gray('- Translation changes')}`, value: '[I18N]' },
    { name: `📦 MIG ${chalk.gray('- Module migration')}`, value: '[MIG]' },
    { name: `🔄 REF ${chalk.gray('- Code refactoring')}`, value: '[REF]' },
    { name: `🎉 REL ${chalk.gray('- Release commit')}`, value: '[REL]' },
    { name: `🗑️ REM ${chalk.gray('- Removing unnecessary files')}`, value: '[REM]' },
    { name: `✏️ REN ${chalk.gray('- Renaming files/variables/models/etc.')}`, value: '[REN]' },
    { name: `🔙 REV ${chalk.gray('- Revert of an existing commit')}`, value: '[REV]' },
    { name: `🧳 SUB ${chalk.gray('- Submodule adding/updating')}`, value: '[SUB]' },
    { name: `#️⃣ VER ${chalk.gray('- Versioning')}`, value: '[VER]' },
];

const commitTypes = [
    { name: '🔧 Workflow', value: 'workflow' },
    { name: '📋 Module', value: 'module' },
    { name: '👤 Wizard', value: 'wizard' },
    { name: '⚙️  Symphony Process', value: 'symphony' },
];

async function commit() {
    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);

    const unstagedChanges = await execGit(['diff', '--name-only'], ADDONS_PATH);
    const stagedChanges = await execGit(['diff', '--cached', '--name-only'], ADDONS_PATH);

    let stageFilesAnswers = [];

    if (!stagedChanges.trim()) {
        console.log(chalk.yellow('No staged changes found.'));
        console.log(chalk.yellow('Unstaged changes:'));
        console.log(unstagedChanges);

        stageFilesAnswers = await inquirer.prompt([
            {
                message: 'Select unstaged files to stage for commit:',
                type: 'checkbox',
                name: 'filesToStage',
                choices: unstagedChanges
                    .trim()
                    .split('\n')
                    .map((file) => file),
            },
        ]);
    } else {
        console.log(chalk.green('Staged changes:'));
        console.log(stagedChanges);
    }

    const answers = await inquirer.prompt([
        {
            type: 'search-list',
            message: 'Select an operation:',
            name: 'commitOperation',
            choices: commitOperations,
        },
        {
            type: 'search-list',
            message: 'Select what has been changed:',
            name: 'commitType',
            choices: commitTypes,
            when(answers) {
                return answers.commitOperation !== '[DOC]';
            },
        },
        {
            type: 'input',
            message(answers) {
                return `Please enter the name of the ${answers.commitType}:`;
            },
            name: 'commitModule',
            default: 'config_wf_',
            when(answers) {
                return answers.commitType === 'workflow' || answers.commitType === 'module';
            },
            filter(input) {
                let value = input.trim();

                if (!value.startsWith('[')) {
                    value = `[${value}`;
                }

                if (!value.endsWith(']')) {
                    value = `${value}]`;
                }

                return value;
            },
        },
        {
            type: 'input',
            message: 'Please enter your message:',
            name: 'commitMessage',
            filter: (input) => input.trim(),
            when(answers) {
                return answers.commitOperation !== '[DOC]';
            },
        },
    ]);

    if (answers.commitOperation === '[DOC]') {
        answers.commitModule = '[CHANGELOG]';
        answers.commitMessage = 'Changelog';
    }

    if (answers.commitType === 'wizard') {
        answers.commitModule = '[.cloudbuild/pb/B2WA/processes/all]';
    }

    if (answers.commitType === 'symphony') {
        answers.commitModule = '[.cloudbuild/symphony/B2WA/processes/all]';
    }

    const commitMessage = `${answers.commitOperation}${answers.commitModule} ${answers.commitMessage}`;

    const finalPrompt = await inquirer.prompt([
        {
            type: 'confirm',
            message: `${chalk.red(commitMessage)}\nDo you want to proceed with this commit message?`,
            name: 'confirmCommit',
        },
    ]);

    if (finalPrompt.confirmCommit) {
        if (stageFilesAnswers.filesToStage && stageFilesAnswers.filesToStage.length > 0) {
            await execGit(['add', ...stageFilesAnswers.filesToStage], ADDONS_PATH);
        }
        await execGit(['commit', '-m', commitMessage], ADDONS_PATH);
    }
}

export { commit };
