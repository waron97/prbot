// Eslint rules for pb/lrp scriptTask bodies (Activiti's plain ES5 JS engine).
// Consumed two ways:
//   - programmatically, by `agrippa pb lint` (shells out to the workspace's
//     own installed eslint against the rules configured in its
//     eslint.config.mjs, which imports this module — see agrippa init)
//   - directly, by a generated workspace's eslint.config.mjs:
//       import agrippa from '@waron97/prbot/eslint';
//       export default [agrippa.configs.pbScripts];

import pluginEs5 from 'eslint-plugin-es5';
import noEmptyErrorCode from './rules/no-empty-error-code.js';

const plugin = {
    meta: { name: '@waron97/prbot-agrippa-eslint' },
    rules: {
        'no-empty-error-code': noEmptyErrorCode,
    },
};

const configs = {
    // Flat-config object, scoped to pb/lrp script bodies in a workspace laid
    // out per agrippa's convention: `<project-dir>/scripts/*.js`.
    pbScripts: {
        files: ['*/scripts/*.js'],
        ignores: ['*/.backup/**'],
        plugins: {
            es5: pluginEs5,
            agrippa: plugin,
        },
        languageOptions: {
            globals: { execution: 'writable' },
        },
        rules: {
            'es5/no-arrow-functions': 'error',
            'es5/no-binary-and-octal-literals': 'error',
            'es5/no-block-scoping': 'error',
            'es5/no-classes': 'error',
            'es5/no-computed-properties': 'error',
            'es5/no-default-parameters': 'error',
            'es5/no-destructuring': 'error',
            'es5/no-es6-methods': 'error',
            'es5/no-es6-static-methods': 'error',
            'es5/no-exponentiation-operator': 'error',
            'es5/no-for-of': 'error',
            'es5/no-generators': 'error',
            'es5/no-modules': 'error',
            'es5/no-object-super': 'error',
            'es5/no-rest-parameters': 'error',
            'es5/no-shorthand-properties': 'error',
            'es5/no-spread': 'error',
            'es5/no-template-literals': 'error',
            'es5/no-typeof-symbol': 'error',
            'es5/no-unicode-code-point-escape': 'error',
            'es5/no-unicode-regex': 'error',
            'agrippa/no-empty-error-code': 'error',
        },
    },
};

plugin.configs = configs;

export default plugin;
export { configs };
