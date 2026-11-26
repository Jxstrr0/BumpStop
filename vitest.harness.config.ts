import { defineConfig } from 'vitest/config'

/**
 * Balance harnesses (plan PR 13): long runs that print tables for tuning.
 * Not part of `npm run test`; run one by hand with
 * `npx vitest run --config vitest.harness.config.ts <name>`.
 */
export default defineConfig({
  test: {
    include: ['scripts/harness/**/*.harness.ts'],
    environment: 'node',
    testTimeout: 3_600_000,
  },
})
