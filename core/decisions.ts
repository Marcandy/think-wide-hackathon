import type { Decision } from "../generated/types";
import { nextRevision } from "./revision";

export function decisionRevision(
	kind: Decision["kind"],
	current: number,
): number {
	switch (kind) {
		case "correction":
		case "constraint":
		case "rejection":
		case "acceptance":
			return nextRevision(current);
	}
}
