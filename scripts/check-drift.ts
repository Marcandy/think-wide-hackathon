// Generate twice into clean temp dirs; both must equal each other and the committed generated/.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const gen = (dir: string) => {
	const r = spawnSync("bun", [join(root, "scripts/codegen.ts"), dir], {
		cwd: root,
		encoding: "utf8",
	});
	if (r.status !== 0) throw new Error(r.stderr);
};
const a = mkdtempSync(join(tmpdir(), "tw-gen-a-"));
const b = mkdtempSync(join(tmpdir(), "tw-gen-b-"));
gen(a);
gen(b);
const committed = join(root, "generated");
const names = new Set([
	...readdirSync(a),
	...readdirSync(b),
	...readdirSync(committed),
]);
const problems: string[] = [];
for (const n of [...names].sort()) {
	const read = (d: string) => {
		try {
			return readFileSync(join(d, n), "utf8");
		} catch {
			return null;
		}
	};
	const [x, y, z] = [read(a), read(b), read(committed)];
	if (x !== y) problems.push(`${n}: generation is not deterministic`);
	if (x !== z)
		problems.push(
			`${n}: committed generated/ is stale or hand-edited (run: bun run codegen)`,
		);
}
rmSync(a, { recursive: true });
rmSync(b, { recursive: true });
if (problems.length) {
	console.error(`contract drift:\n  ${problems.join("\n  ")}`);
	process.exit(1);
}
console.log(`contract drift: none (${names.size} files, generated twice)`);
