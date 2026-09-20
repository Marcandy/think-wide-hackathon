// Tests run in plain Node without the app's Vite plugins (TanStack Start + Nitro start dev servers).
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts", "core/**/*.test.ts"],
		exclude: ["tests/browser/**", "node_modules/**"],
	},
});
