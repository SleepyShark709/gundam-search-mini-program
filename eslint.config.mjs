import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'typings/**',
      'miniprogram/data/**',
      'server/public/**',
    ],
  },
  js.configs.recommended,
  {
    // Cache reads and best-effort connection cleanup may deliberately ignore errors.
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      // Existing API boundaries use any; tighten these incrementally.
      '@typescript-eslint/no-explicit-any': 'off',
      // WeChat loads the two local JS data modules through require.
      '@typescript-eslint/no-require-imports': 'off',
      // Express extends Request through an ambient namespace declaration.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    files: ['miniprogram/**/*.ts'],
    languageOptions: {
      globals: {
        wx: 'readonly',
        App: 'readonly',
        Page: 'readonly',
        Component: 'readonly',
        Behavior: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
        require: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    files: ['server/**/*.ts', 'admin/src/**/*.ts', 'tests/**/*.cjs', 'scripts/**/*.cjs', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['admin/public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
    // The admin HTML invokes top-level functions through inline handlers.
    rules: { 'no-unused-vars': ['error', { vars: 'local', caughtErrors: 'none' }] },
  },
);
