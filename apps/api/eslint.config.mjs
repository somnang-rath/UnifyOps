// Flat config (ESLint v9). The `lint` script previously invoked eslint with no
// config file present, so it always errored out and never actually linted.
// This is a deliberately lenient baseline: typescript-eslint's non-type-checked
// recommended set, plus prettier to disable stylistic rules. Tighten over time.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // No `project` on purpose — type-aware linting is slow and noisy for a
        // first pass. Add it (recommendedTypeChecked) once the baseline is clean.
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      // NestJS leans on decorators + DI; these defaults fight that idiom.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    // Uses NUL (\x00) as an intra-string placeholder delimiter — deliberate.
    files: ['src/modules/chat/telegram/telegram-format.util.ts'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    // Tests use a looser style.
    files: ['test/**/*.ts', '**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
