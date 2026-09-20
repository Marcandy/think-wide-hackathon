import { spawn } from "node:child_process";
import type { OperationError } from "../../../generated/types";

export class GitSourceError extends Error {
	constructor(
		readonly code: OperationError["code"],
		message: string,
	) {
		super(message);
		this.name = "GitSourceError";
	}
}

// Only an application-created bare directory reaches this runner. Never point it
// at a target working tree: even read-only Git commands can discover its config.
export function runGit(
	directory: string,
	args: readonly string[],
	maximum = 2 ** 20,
) {
	return new Promise<Buffer>((resolve, reject) => {
		const child = spawn(
			"/usr/bin/git",
			[
				"--no-pager",
				"--no-replace-objects",
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"core.fsmonitor=false",
				"-c",
				"gc.auto=0",
				"-c",
				"maintenance.auto=false",
				"-c",
				"protocol.allow=never",
				...args,
			],
			{
				cwd: directory,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					PATH: "/usr/bin:/bin",
					HOME: directory,
					XDG_CONFIG_HOME: directory,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
					GIT_CONFIG_SYSTEM: "/dev/null",
					GIT_TERMINAL_PROMPT: "0",
					GIT_NO_LAZY_FETCH: "1",
					GIT_OPTIONAL_LOCKS: "0",
					LC_ALL: "C",
				},
			},
		);
		const chunks: Buffer[] = [];
		let size = 0;
		let limited = false;
		// Git may spawn index-pack during bundle import. Kill its process group,
		// then wait for close so children cannot outlive a cancelled read.
		function stop() {
			limited = true;
			if (child.pid) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					child.kill("SIGKILL");
				}
			}
		}
		const timer = setTimeout(stop, 5000);
		child.stdout.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > maximum) {
				stop();
			} else if (!limited) {
				chunks.push(chunk);
			}
		});
		let diagnosticSize = 0;
		child.stderr.on("data", (chunk: Buffer) => {
			diagnosticSize += chunk.length;
			if (diagnosticSize > maximum) {
				stop();
			}
		});
		child.on("error", () => {
			clearTimeout(timer);
			reject(
				new GitSourceError("source_unavailable", "Git source is unavailable"),
			);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (limited || code !== 0) {
				reject(
					new GitSourceError(
						limited ? "limit_exceeded" : "source_unavailable",
						limited
							? "Git read exceeded its time or output limit"
							: "Git source is unavailable",
					),
				);
			} else {
				resolve(Buffer.concat(chunks));
			}
		});
	});
}

export function assertObjectId(value: string, algorithm: "sha1" | "sha256") {
	if (
		!new RegExp(`^[0-9a-f]{${algorithm === "sha1" ? 40 : 64}}$`).test(value)
	) {
		throw new GitSourceError(
			"invalid_request",
			"Object id does not match its hash algorithm",
		);
	}
}
