import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'next-env.d.ts',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  ...coreWebVitals,
  ...nextTypescript,

  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // --- Tenancy -----------------------------------------------------------
      // The owner connection bypasses RLS and belongs to migrations only.
      // Reaching for it at runtime is the bug, not the RLS policy.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='DATABASE_URL_OWNER']",
          message:
            'DATABASE_URL_OWNER is the owner role and bypasses RLS. Migrations and drizzle-kit only — never the running app.',
        },
      ],

      // --- Bilingual ---------------------------------------------------------
      // next-intl's wrappers carry the locale prefix; the plain ones drop it,
      // and localePrefix is 'always', so a bare next/link breaks the URL.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/link',
              message: "Use { Link } from '@/i18n/navigation' so the locale prefix is kept.",
            },
            {
              name: 'next/navigation',
              importNames: ['redirect', 'permanentRedirect', 'useRouter', 'usePathname'],
              message: "Use the equivalents from '@/i18n/navigation' so the locale prefix is kept.",
            },
          ],
        },
      ],
    },
  },

  // Server bootstrap and config files legitimately read the owner credential.
  {
    files: ['src/server/db/**/*.ts', 'src/env.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];

export default config;
