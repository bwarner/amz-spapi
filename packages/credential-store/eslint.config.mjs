import baseConfig from '../../eslint.config.js';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
          // These three ARE used, and removing them would break the package:
          //   better-sqlite3      src/lib/sqlite-credential-store.ts
          //   @aws-sdk/client-kms src/lib/kms-encryption.ts
          //   axios               src/lib/oauth-flow.ts
          //
          // The rule reports them unused because it analyses the entry point
          // and does not follow this package's `export * from './lib/x.js'`
          // re-exports into the files that import them. Verified 2026-07-29:
          // adding a direct `import 'axios'` to src/index.ts clears the error,
          // and dropping the declaration produces no "missing" error either —
          // the rule sees no imports in src/lib at all.
          ignoredDependencies: [
            'better-sqlite3',
            '@aws-sdk/client-kms',
            'axios',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
