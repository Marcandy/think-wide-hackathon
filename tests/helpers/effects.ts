import { createHash } from "node:crypto";

/**
 * T04 · effect harness.
 *
 * The acceptance suite (Q01) requires checking TWO layers, not one:
 *   1. the bytes a call returns, and
 *   2. the effects it left behind — business state, scheduled jobs, provider dispatch.
 *
 * A denied read that still enqueued a job is a FAILURE, and a status-code assertion
 * cannot see that. The three channels stay separate so a test can assert "denied AND
 * zero jobs AND zero dispatches" rather than collapsing them into one number.
 *
 * Provider dispatch records an ARGUMENT DIGEST only — never the payload
 * (05_SECURITY_AND_CI.md: no source text, tokens or raw traces in evidence).
 *
 * Two properties this harness must never get wrong, both found in review:
 *
 *   - An OBSERVED call is not a COMMITTED effect. Convex writes are asynchronous and a
 *     write can be attempted and then rejected. Counting attempts as effects overstates;
 *     counting only successes hides an attempt that a denial should have prevented. Both
 *     numbers are reported.
 *   - A diff across a `reset()` is meaningless, not empty. Slicing by array length made
 *     it silently report "clean", which would let a real unauthorized write pass as no
 *     effect at all. Snapshots carry a generation and diffing across one throws.
 */

export type StateOp = "insert" | "patch" | "replace" | "delete";

/** Observed, then resolved. An attempt that never settles stays `attempted`. */
export type WriteOutcome = "attempted" | "committed" | "failed";

export type StateWrite = {
	/** Monotonic across the ledger's life, including across resets. */
	readonly seq: number;
	readonly table: string;
	readonly op: StateOp;
	/** Null until an asynchronous insert resolves to its document id. */
	readonly docId: string | null;
	readonly outcome: WriteOutcome;
};

export type JobSchedule = {
	readonly seq: number;
	/** Opaque job id. Never a secret, source payload or prompt. */
	readonly jobId: string;
	readonly reference: string;
	readonly runAtMs: number | null;
};

export type ProviderDispatch = {
	readonly seq: number;
	readonly provider: string;
	readonly model: string;
	/** sha256 of canonical arguments. The arguments themselves are never retained. */
	readonly argumentDigest: string;
};

export type EffectSnapshot = {
	/** Increments on every reset. Two snapshots with different generations cannot be diffed. */
	readonly generation: number;
	/** Highest sequence number issued when the snapshot was taken. */
	readonly seq: number;
	readonly writes: readonly StateWrite[];
	readonly jobs: readonly JobSchedule[];
	readonly dispatches: readonly ProviderDispatch[];
};

export type EffectDiff = {
	readonly writes: readonly StateWrite[];
	readonly jobs: readonly JobSchedule[];
	readonly dispatches: readonly ProviderDispatch[];
	readonly counts: {
		/** Write operations OBSERVED in the window, whatever their outcome. */
		readonly writes: number;
		/** Of those, the ones that resolved successfully. */
		readonly committedWrites: number;
		/** Of those, the ones that were rejected. */
		readonly failedWrites: number;
		readonly jobs: number;
		readonly dispatches: number;
	};
	/** True only when nothing at all was observed on any channel. */
	readonly clean: boolean;
};

/** Canonical JSON only: reject values that JSON would drop or coerce. */
function canonicalize(value: unknown, ancestors = new Set<object>()): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean")
		return JSON.stringify(value);
	if (typeof value === "number" && Number.isFinite(value))
		return JSON.stringify(value);
	if (typeof value !== "object")
		throw new TypeError("Digest arguments must be JSON values");
	if (ancestors.has(value))
		throw new TypeError("Digest arguments must not be cyclic");
	const array = Array.isArray(value);
	const prototype = Object.getPrototypeOf(value);
	if (!array && prototype !== Object.prototype && prototype !== null) {
		throw new TypeError("Digest arguments must contain only plain objects");
	}
	if (Object.getOwnPropertySymbols(value).length)
		throw new TypeError("Symbol keys are not JSON");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	ancestors.add(value);
	try {
		const encode = (key: string): string => {
			const descriptor = descriptors[key];
			if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
				throw new TypeError(
					"Sparse arrays, hidden properties and accessors are not JSON",
				);
			}
			return canonicalize(descriptor.value, ancestors);
		};
		if (array) {
			if (Object.keys(descriptors).length !== value.length + 1) {
				throw new TypeError(
					"Sparse arrays and extra array properties are not JSON",
				);
			}
			return (
				"[" +
				Array.from({ length: value.length }, (_, i) => encode(String(i))).join(
					",",
				) +
				"]"
			);
		}
		return (
			"{" +
			Object.keys(descriptors)
				.sort()
				.map((key) => JSON.stringify(key) + ":" + encode(key))
				.join(",") +
			"}"
		);
	} finally {
		ancestors.delete(value);
	}
}

export function digestArguments(value: unknown): string {
	return `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;
}

type MutableWrite = { -readonly [K in keyof StateWrite]: StateWrite[K] };

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

export class EffectLedger {
	#writes: MutableWrite[] = [];
	#jobs: JobSchedule[] = [];
	#dispatches: ProviderDispatch[] = [];
	#generation = 0;
	#seq = 0;

	#next(): number {
		this.#seq += 1;
		return this.#seq;
	}

	/**
	 * Records a write. `outcome` defaults to `committed` for a directly recorded effect;
	 * the instrumentation wrapper records `attempted` first and settles it later.
	 */
	recordWrite(write: {
		table: string;
		op: StateOp;
		docId: string | null;
		outcome?: WriteOutcome;
	}): {
		settle: (
			outcome: Exclude<WriteOutcome, "attempted">,
			docId?: string | null,
		) => void;
	} {
		const entry: MutableWrite = {
			seq: this.#next(),
			table: write.table,
			op: write.op,
			docId: write.docId,
			outcome: write.outcome ?? "committed",
		};
		this.#writes.push(entry);
		return {
			settle: (outcome, docId) => {
				entry.outcome = outcome;
				if (docId !== undefined) entry.docId = docId;
			},
		};
	}

	recordJob(job: {
		jobId: string;
		reference: string;
		runAtMs: number | null;
	}): void {
		this.#jobs.push(Object.freeze({ seq: this.#next(), ...job }));
	}

	/**
	 * Takes raw arguments only to digest them; they are not stored. A caller that already
	 * holds a digest passes it as `digest` instead.
	 */
	recordDispatch(input: {
		provider: string;
		model: string;
		args?: unknown;
		digest?: string;
	}): ProviderDispatch {
		const entry = Object.freeze({
			seq: this.#next(),
			provider: input.provider,
			model: input.model,
			argumentDigest: input.digest ?? digestArguments(input.args),
		});
		this.#dispatches.push(entry);
		return entry;
	}

	snapshot(): EffectSnapshot {
		return Object.freeze({
			generation: this.#generation,
			seq: this.#seq,
			// Copied and frozen at snapshot time: a later settle must not mutate a
			// snapshot already taken.
			writes: Object.freeze(this.#writes.map((w) => Object.freeze({ ...w }))),
			jobs: Object.freeze([...this.#jobs]),
			dispatches: Object.freeze([...this.#dispatches]),
		});
	}

	/** Clears every channel and advances the generation. Sequence numbers keep rising. */
	reset(): void {
		this.#writes = [];
		this.#jobs = [];
		this.#dispatches = [];
		this.#generation += 1;
	}

	get generation(): number {
		return this.#generation;
	}
}

export function emptySnapshot(): EffectSnapshot {
	return Object.freeze({
		generation: 0,
		seq: 0,
		writes: Object.freeze([]),
		jobs: Object.freeze([]),
		dispatches: Object.freeze([]),
	});
}

/**
 * What happened between two snapshots of the SAME ledger generation.
 *
 * Diffing across a reset throws rather than returning an empty result: the entries that
 * would prove an effect no longer exist, so "clean" would be a lie, and a lie in exactly
 * the direction that hides an unauthorized write.
 */
export function diffEffects(
	before: EffectSnapshot,
	after: EffectSnapshot,
): EffectDiff {
	if (before.generation !== after.generation) {
		throw new Error(
			`effect snapshots span a ledger reset (generation ${before.generation} -> ${after.generation}); ` +
				"the diff would report clean regardless of what happened. Snapshot again after reset().",
		);
	}
	if (after.seq < before.seq) {
		throw new Error(
			`effect snapshots are out of order (seq ${before.seq} -> ${after.seq})`,
		);
	}

	const since = before.seq;
	const writes = after.writes.filter((w) => w.seq > since);
	const jobs = after.jobs.filter((j) => j.seq > since);
	const dispatches = after.dispatches.filter((d) => d.seq > since);

	return Object.freeze({
		writes,
		jobs,
		dispatches,
		counts: Object.freeze({
			writes: writes.length,
			committedWrites: writes.filter((w) => w.outcome === "committed").length,
			failedWrites: writes.filter((w) => w.outcome === "failed").length,
			jobs: jobs.length,
			dispatches: dispatches.length,
		}),
		clean: writes.length === 0 && jobs.length === 0 && dispatches.length === 0,
	});
}

type AnyFn = (...args: never[]) => unknown;

/**
 * Wraps a real Convex-style `ctx.db` so effects are observed without replacing policy.
 * This instruments; it does not decide.
 *
 * Convex mutations are asynchronous, so the wrapper records the attempt immediately and
 * settles it when the underlying promise resolves or rejects. The handler's return value
 * and thrown error pass through unchanged — an instrument that alters behaviour is not
 * an instrument.
 */
export function instrumentDb<T extends Record<string, unknown>>(
	db: T,
	ledger: EffectLedger,
): T {
	const ops: readonly StateOp[] = ["insert", "patch", "replace", "delete"];
	return new Proxy(db, {
		get(target, prop, receiver) {
			const original = Reflect.get(target, prop, receiver);
			if (typeof original !== "function" || !ops.includes(prop as StateOp))
				return original;
			const op = prop as StateOp;
			return (...args: unknown[]) => {
				// insert(table, doc) vs patch/replace/delete(id, ...)
				const table = op === "insert" ? String(args[0]) : "unknown";
				const knownDocId = op === "insert" ? null : String(args[0]);
				const record = ledger.recordWrite({
					table,
					op,
					docId: knownDocId,
					outcome: "attempted",
				});

				let result: unknown;
				try {
					result = (original as AnyFn).apply(target, args as never[]);
				} catch (error) {
					record.settle("failed");
					throw error;
				}

				if (!isThenable(result)) {
					record.settle(
						"committed",
						op === "insert" ? String(result) : knownDocId,
					);
					return result;
				}

				return Promise.resolve(result).then(
					(value) => {
						record.settle(
							"committed",
							op === "insert" ? String(value) : knownDocId,
						);
						return value;
					},
					(error: unknown) => {
						record.settle("failed");
						throw error;
					},
				);
			};
		},
	});
}

/**
 * Wraps a real `ctx.scheduler`. The opaque job id is recorded; arguments are not.
 *
 * Scheduling from a mutation is atomic with that mutation, so a recorded job is an
 * admitted effect even when the call's return value was a denial.
 */
export function instrumentScheduler<T extends Record<string, unknown>>(
	scheduler: T,
	ledger: EffectLedger,
): T {
	return new Proxy(scheduler, {
		get(target, prop, receiver) {
			const original = Reflect.get(target, prop, receiver);
			if (typeof original !== "function") return original;
			const name = String(prop);
			if (name !== "runAfter" && name !== "runAt") return original;
			return async (...args: unknown[]) => {
				const jobId = await (original as AnyFn).apply(target, args as never[]);
				ledger.recordJob({
					jobId: String(jobId),
					reference: String(args[1] ?? "unknown"),
					runAtMs: typeof args[0] === "number" ? args[0] : null,
				});
				return jobId;
			};
		},
	});
}
