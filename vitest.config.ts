import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Merge of the T02 (main) and T04 configs. Both branches added this file; neither
// version alone runs both suites correctly.
//
// Deliberately does NOT load vite.config.ts. That config boots nitro, tanstackStart and
// devtools; under `vitest run` those leave Vite servers alive and the run reports
// "close timed out after 10000ms". These are node-level domain/boundary checks and need
// none of it. A browser-environment suite (tests/browser) gets its own project.
const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
	resolve: {
		// tsconfigPaths comes from T02. The explicit aliases are kept because they are
		// what the T04 suites were verified against; the two agree with tsconfig.json.
		tsconfigPaths: true,
		alias: [
			{ find: /^#\//, replacement: `${src}/` },
			{ find: /^@\//, replacement: `${src}/` },
		],
	},
	test: {
		environment: "node",
		// Broad globs, from T02. T04 originally listed one entry per ticket area so a
		// missing directory would be visible, but a glob serves that goal better: a new
		// tests/ subdirectory is picked up automatically instead of silently never
		// running, which looks identical to passing. `.spec.ts` is included so a file
		// named that way is not skipped without anyone noticing.
		include: ["tests/**/*.{test,spec}.ts", "core/**/*.{test,spec}.ts"],
		// Fixtures are data, not suites - tests/fixtures holds byte-exact inputs and git
		// bundles. tests/browser needs a DOM environment and gets its own config rather
		// than failing silently under environment: "node".
		exclude: ["**/node_modules/**", "tests/fixtures/**", "tests/browser/**"],
		// Vitest 5: pool options are top-level (poolOptions was removed in v4).
		pool: "forks",
		maxWorkers: 1,
		isolate: true,
		// Fail fast in CI rather than hanging against the 10-minute job timeout.
		testTimeout: 15_000,
		hookTimeout: 15_000,
		teardownTimeout: 5_000,
		reporters: ["default"],
		// The T04 provider and effect suites use vi.fn(); without these, mock state
		// leaks between tests and a passing run stops meaning anything.
		clearMocks: true,
		restoreMocks: true,
	},
});
