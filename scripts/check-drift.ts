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
// Every path under a root, recursively. Directories end in "/" so that a name which is a file
// on one side and a directory on the other is two different paths, i.e. drift.
const walk = (dir: string, prefix = ""): string[] =>
	readdirSync(join(dir, prefix), { withFileTypes: true })
		.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
		.flatMap((e) =>
			e.isDirectory()
				? [`${prefix}${e.name}/`, ...walk(dir, `${prefix}${e.name}/`)]
				: [`${prefix}${e.name}`],
		);
const listings = [a, b, committed].map((d) => new Set(walk(d)));
const names = new Set(listings.flatMap((l) => [...l]));
const problems: string[] = [];
for (const n of [...names].sort()) {
	const [inA, inB, inCommitted] = listings.map((l) => l.has(n));
	if (inA !== inB) {
		problems.push(`${n}: generation is not deterministic (path set differs)`);
		continue;
	}
	if (inA !== inCommitted) {
		problems.push(
			inCommitted
				? `${n}: committed generated/ has a path codegen does not produce (remove it, or a file/directory mismatch)`
				: `${n}: missing from committed generated/ (run: bun run codegen)`,
		);
		continue;
	}
	if (n.endsWith("/")) continue;
	const read = (d: string) => readFileSync(join(d, n), "utf8");
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
const fileCount = [...names].filter((n) => !n.endsWith("/")).length;
console.log(`contract drift: none (${fileCount} files, generated twice)`);
