import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/aws-secrets',
  plugins: [],
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    // Every test in this project talks to a live Couchbase cluster over HTTP;
    // a single query can take seconds, and the hook that provisions the test
    // scope polls for the collection to become queryable.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      reportsDirectory: '../../coverage/libs/aws-secrets',
      provider: 'v8',
    },
  },
});
