/**
 * What: ESLint flat configuration applied to every JavaScript file in the monorepo.
 * Why: Enforces a common code-quality baseline (no eval, strict equality, no unused vars) as part
 *     of the CI gate.
 * If missing or unlinked: npm run lint fails with "no configuration found" and code-quality
 *     problems reach main unchecked.
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      '**/gen/**',
      '**/tmp/**',
      '**/test/fixtures/**',
      // Template files are rendered into generated projects and linted there.
      'packages/*/templates/**',
      // Generated projects carry their own lint configuration.
      'reference-apps/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' }],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    // CAP service handlers use CAP's global query builders.
    files: ['packages/s4-mock/srv/**/*.js'],
    languageOptions: { globals: { SELECT: 'readonly', INSERT: 'readonly', UPSERT: 'readonly', UPDATE: 'readonly', DELETE: 'readonly' } },
  },
];
