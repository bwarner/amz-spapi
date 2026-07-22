import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Workspace packages (mirrors tsconfig.base.json paths).
      '@farvisionllc/models': resolve(
        __dirname,
        '../../packages/models/src/index.ts'
      ),
    },
  },
});
