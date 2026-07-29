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
          // Genuinely imported in src; removing them would break the package.
          //   axios   src/lib/ad-client.ts
          //
          // The rule reports them unused because it analyses the entry point
          // and does not follow this package's `export * from './lib/x.js'`
          // re-exports into the files that import them. Verified 2026-07-29 in
          // credential-store: adding a direct import to index.ts clears the
          // error, and dropping the declaration produces no "missing" error
          // either — the rule sees no imports under src/lib at all.
          ignoredDependencies: ['axios'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
