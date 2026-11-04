// ESLint flat config. Run with `npm run lint` (after `npm install`).
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['public/vendor/**', 'node_modules/**', 'dist/**'] },
  js.configs.recommended,
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['server.js', 'tools/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': ['warn', { destructuring: 'all' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
    },
  },
];
