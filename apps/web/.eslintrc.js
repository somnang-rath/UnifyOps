/**
 * ESLint config for apps/web.
 *
 * JS rather than JSON so the `overrides` below can explain themselves. Every
 * exemption from the `toLocale*` ban is a real decision about whether a piece
 * of text is *chrome* (follows the reader's language) or *data* (must look the
 * same to everyone), and that distinction is invisible from the file path.
 */
module.exports = {
  extends: 'next/core-web-vitals',
  ignorePatterns: ['.next/', 'node_modules/', 'next-env.d.ts', '*.tsbuildinfo'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'react/no-unescaped-entities': 'off',
    '@next/next/no-img-element': 'off',

    // ADR 0016 §2.7 — the one mechanical guard available for the formatting
    // seam. `toLocaleLowerCase`/`UpperCase` are deliberately *not* matched:
    // those are case folding, not formatting.
    'no-restricted-syntax': [
      'error',
      {
        selector:
          'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
        message:
          "Use the @prism/i18n seam (ADR 0016 §2.7): useFormat() in client components, formatDate/formatNumber with an explicit locale on the server, dateKey() for a grouping key. A bare toLocale* renders English regardless of the user's language.",
      },
    ],
  },
  overrides: [
    {
      // Spreadsheet number formats are DATA, not chrome. A cell its author
      // formatted as `1,234.56` must render identically for every viewer, or
      // two people reading one workbook see two different numbers. The formula
      // engine's TEXT()/FIXED() are the same argument with a stronger case:
      // their output can be referenced by another formula.
      files: [
        'src/lib/sheets/**',
        'src/components/feature/sheets/**',
        'src/lib/kpi-format.ts',
      ],
      rules: { 'no-restricted-syntax': 'off' },
    },
    {
      // Report elements carry an author-chosen format code (int/dec2/pct/…)
      // and render into a document that gets exported and emailed. Locale
      // switching them would change a delivered PDF depending on who opened it.
      files: [
        'src/components/feature/reports/element-*.tsx',
        'src/components/feature/reports/canvas-editor.tsx',
      ],
      rules: { 'no-restricted-syntax': 'off' },
    },
    {
      // The kiosk report display is deliberately single-locale: its labels are
      // hardcoded Khmer, so its dates are pinned to km-KH to match. Following
      // the UI locale here would give Khmer labels with English dates.
      files: ['src/app/(app)/reports/display/**'],
      rules: { 'no-restricted-syntax': 'off' },
    },
  ],
};
