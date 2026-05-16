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
    { name: `🛠️  IMP ${chalk.gray('- Improvement of existing code')}`, value: '[IMP]' },
    { name: `💬 I18N ${chalk.gray('- Translation changes')}`, value: '[I18N]' },
    { name: `📦 MIG ${chalk.gray('- Module migration')}`, value: '[MIG]' },
    { name: `🔄 REF ${chalk.gray('- Code refactoring')}`, value: '[REF]' },
    { name: `🎉 REL ${chalk.gray('- Release commit')}`, value: '[REL]' },
    { name: `🗑️  REM ${chalk.gray('- Removing unnecessary files')}`, value: '[REM]' },
    { name: `✏️  REN ${chalk.gray('- Renaming files/variables/models/etc.')}`, value: '[REN]' },
    { name: `🔙 REV ${chalk.gray('- Revert of an existing commit')}`, value: '[REV]' },
    { name: `🧳 SUB ${chalk.gray('- Submodule adding/updating')}`, value: '[SUB]' },
    { name: `#️⃣  VER ${chalk.gray('- Versioning')}`, value: '[VER]' },
];

function getModuleFromFile(file) {
    const parts = file.split('/');

    if (parts[0] === 'config') {
        return parts[1];
    }

    if (parts[0] === '.cloudbuild') {
        const allIndex = parts.indexOf('all');

        if (allIndex !== -1) {
            return parts.slice(0, allIndex + 1).join('/');
        }
    }

    return parts[0];
}

function validateSameModule(files) {
    const modules = files.map(getModuleFromFile);
    const currentModule = `[${modules[0]}]`;

    const allSameModule = modules.every((module) => `[${module}]` === currentModule);

    if (!allSameModule) {
        console.log(chalk.red('Selected files are not of the same module'));
        return null;
    }

    return currentModule;
}

async function getFilesToCommit(stagedChanges, unstagedChanges) {
    if (stagedChanges.trim()) {
        console.log(chalk.green('Staged changes:'));
        console.log(stagedChanges);

        return {
            filesToCheck: stagedChanges.trim().split('\n'),
            filesToStage: [],
        };
    }

    const unstagedFiles = unstagedChanges.trim().split('\n');

    while (true) {
        console.log(chalk.yellow('No staged changes found.'));
        console.log(chalk.yellow('Unstaged changes:'));
        console.log(unstagedChanges);

        const answers = await inquirer.prompt([
            {
                message: 'Select unstaged files to stage for commit:',
                type: 'checkbox',
                name: 'filesToStage',
                choices: unstagedFiles,
            },
        ]);

        const currentModule = validateSameModule(answers.filesToStage);

        if (currentModule) {
            return {
                filesToCheck: answers.filesToStage,
                filesToStage: answers.filesToStage,
                currentModule,
            };
        }
    }
}

async function commit() {
    const ADDONS_PATH = resolveAddonsPath(process.env.ADDONS_PATH);

    while (true) {
        const unstagedChanges = await execGit(['diff', '--name-only'], ADDONS_PATH);
        const stagedChanges = await execGit(['diff', '--cached', '--name-only'], ADDONS_PATH);

        if (!unstagedChanges.trim() && !stagedChanges.trim()) {
            console.log(chalk.red('No changes found to commit.'));
            return;
        }

        const {
            filesToCheck,
            filesToStage,
            currentModule: selectedModule,
        } = await getFilesToCommit(stagedChanges, unstagedChanges);

        if (filesToCheck.length === 0) {
            console.log(chalk.red('No files selected.'));
            return;
        }

        let currentModule = selectedModule || validateSameModule(filesToCheck);

        if (!currentModule) {
            return;
        }

        const answers = await inquirer.prompt([
            {
                type: 'search-list',
                message: 'Select an operation:',
                name: 'commitOperation',
                choices: commitOperations,
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
            currentModule = '[CHANGELOG]';
            answers.commitMessage = 'Changelog';
        }

        const commitMessage = `${answers.commitOperation}${currentModule} ${answers.commitMessage}`;

        const finalPrompt = await inquirer.prompt([
            {
                type: 'confirm',
                message: `${chalk.red(commitMessage)}\nDo you want to proceed with this commit message?`,
                name: 'confirmCommit',
            },
        ]);

        if (!finalPrompt.confirmCommit) {
            return;
        }

        if (filesToStage.length > 0) {
            await execGit(['add', ...filesToStage], ADDONS_PATH);
        }

        await execGit(['commit', '-m', commitMessage], ADDONS_PATH);
        console.log(chalk.green('Commit created successfully!'));

        const remainingUnstaged = await execGit(['diff', '--name-only'], ADDONS_PATH);
        const remainingStaged = await execGit(['diff', '--cached', '--name-only'], ADDONS_PATH);

        if (!remainingUnstaged.trim() && !remainingStaged.trim()) {
            console.log(chalk.green('No more changes to commit.'));
            break;
        }

        const { continueCommit } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'continueCommit',
                message: 'Do you want to create another commit?',
                default: true,
            },
        ]);

        if (!continueCommit) {
            break;
        }
    }
}

export { commit };
