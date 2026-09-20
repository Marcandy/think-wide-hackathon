export const SEARCH_CAPS = {
	/** Snapshots per request. The contract also caps snapshotIds at 2. */
	maxSnapshots: 2,
	/** Files opened per request, across all snapshots. */
	maxFiles: 200,
	/** Bytes actually scanned per request. */
	maxScanBytes: 20 * 1024 * 1024,
	/** Wall clock for one search, including the analyzer subprocess. */
	wallClockMs: 5_000,
	/** Hits per page. Never infer a total from a capped page. */
	hitsPerPage: 20,
	/** Bytes of source text any single result may carry. */
	maxResultTextBytes: 16 * 1024,
	/** Contract bound on the literal query itself. */
	maxQueryBytes: 256,
} as const;

export const OPERATION_LIMITS = {
	requestBytes: 131072,
	resultBytes: 16384,
	treeChildrenPerPage: 100,
	exactWindowBytes: 16384,
} as const;
