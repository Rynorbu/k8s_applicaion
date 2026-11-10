import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'kubernetes/**', 'frontend/playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['shared/**/*.js', 'services/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs', '*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      // Object-injection warnings are noisy for validated lookups; property access is reviewed manually.
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/tests/**/*.js', '**/*.test.js'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
  {
    files: ['frontend/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.3' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['frontend/*.config.js', 'frontend/e2e/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
];
