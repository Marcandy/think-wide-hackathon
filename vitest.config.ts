import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Deliberately does NOT load vite.config.ts. That config boots nitro, tanstackStart and
// devtools; under `vitest run` those leave Vite servers alive and the run reports
// "close timed out after 10000ms". Tests here are node-level domain/boundary checks and
// need none of it. A browser-environment suite (tests/browser) gets its own project.
const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^#\//, replacement: `${src}/` },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    environment: 'node',
    // One entry per ticket's writable test area. A directory missing here means its
    // tests silently never run - which looks identical to passing.
    include: [
      'tests/domain/**/*.{test,spec}.ts',        // T04
      'tests/adapter/**/*.{test,spec}.ts',       // T04 / T08
      'tests/boundary/**/*.{test,spec}.ts',      // T04 permission + effect boundary
      'tests/structural/**/*.{test,spec}.ts',    // T07 literal + ast-grep rules
      'tests/integration/**/*.{test,spec}.ts',   // T11
      'tests/e2e/**/*.{test,spec}.ts',           // T11 full loop
    ],
    // Fixtures are data, not suites. tests/browser needs a DOM environment and gets
    // its own config rather than silently failing under environment: 'node'.
    exclude: ['**/node_modules/**', 'tests/fixtures/**', 'tests/browser/**'],
    // Vitest 5: pool options are top-level (poolOptions was removed in v4).
    pool: 'forks',
    maxWorkers: 1,
    isolate: true,
    // Fail fast in CI rather than hanging against the 10-minute job timeout.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    teardownTimeout: 5_000,
    reporters: ['default'],
    clearMocks: true,
    restoreMocks: true,
  },
})
