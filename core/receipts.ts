/** Bounded canonical JSON: preserve array order; reject non-JSON input. */
export function canonicalArguments(value: unknown, depth = 0): string {
	if (depth > 32) throw new TypeError("Input exceeds maximum depth");
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return JSON.stringify(value);
	if (
		typeof value === "number" &&
		Number.isFinite(value) &&
		Math.abs(value) <= Number.MAX_SAFE_INTEGER
	)
		return JSON.stringify(value);
	if (Array.isArray(value))
		return `[${value.map((item) => canonicalArguments(item, depth + 1)).join(",")}]`;
	if (
		typeof value === "object" &&
		value !== null &&
		(Object.getPrototypeOf(value) === Object.prototype ||
			Object.getPrototypeOf(value) === null)
	) {
		return `{${Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(
				([key, item]) =>
					`${JSON.stringify(key)}:${canonicalArguments(item, depth + 1)}`,
			)
			.join(",")}}`;
	}
	throw new TypeError("Input must be JSON");
}

export async function argumentDigest(value: unknown): Promise<string> {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalArguments(value)),
	);
	return Array.from(new Uint8Array(hash), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export function compareReceipt(
	previousDigest: string | undefined,
	digest: string,
): "new" | "replay" | "conflict" {
	return previousDigest === undefined
		? "new"
		: previousDigest === digest
			? "replay"
			: "conflict";
}
