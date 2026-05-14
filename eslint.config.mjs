import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig(
    js.configs.recommended,
    { ignores: ['node_modules'] },
    {
        languageOptions: {
            globals: globals.node,
        },
        rules: {
            'no-console': 'warn',
        },
    }
);
