export function compareRevision(
	expected: number,
	current: number,
): "ok" | "revision_conflict" {
	return Number.isSafeInteger(expected) && expected === current
		? "ok"
		: "revision_conflict";
}

export function nextRevision(current: number): number {
	if (
		!Number.isSafeInteger(current) ||
		current < 0 ||
		current === Number.MAX_SAFE_INTEGER
	)
		throw new RangeError("Revision exhausted");
	return current + 1;
}
