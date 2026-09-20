import { describe, expect, it } from "vitest";

// Smoke test for T04's harness wiring. Proves the runner discovers tests/domain,
// resolves TS, and that assertions genuinely fail when they should - a suite that
// cannot fail is not evidence.
describe("harness wiring", () => {
	it("runs and asserts", () => {
		expect(1 + 1).toBe(2);
	});

	it("reports a real failure (negative control)", () => {
		let failed = false;
		try {
			expect(1).toBe(2);
		} catch {
			failed = true;
		}
		expect(failed).toBe(true);
	});
});
