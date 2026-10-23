import { defineConfig } from 'vitest/config';

/** Database integration tests; need `supabase start` (Docker). Run with `npm run test:db`. */
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
