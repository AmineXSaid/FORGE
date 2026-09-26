import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';

/**
 * `pnpm run lint`, part of `pnpm run verify` and so of `pnpm run package`.
 *
 * `.vue` files go through vue-eslint-parser, with the TypeScript parser for
 * their `<script>` blocks: parsed as plain TypeScript, every SFC was a parse
 * error (159 of them, production audit 2026-09-24). `curly` is `multi-line`,
 * the codebase's own style: a one-line `if (x) return;` is fine, a body that
 * spans lines needs braces.
 */
const rules = {
  curly: ['error', 'multi-line'],
  // Named by the codebase's own eslint-disable comments (the official \`lA0\`,
  // Windows file-name checks), so it is on.
  'no-control-regex': 'error',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }]
};

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': typescriptEslint
    },
    rules
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: typescriptParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue']
      }
    },
    plugins: {
      '@typescript-eslint': typescriptEslint
    },
    rules
  },
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.js', '**/*.cjs', '**/*.mjs']
  }
];
