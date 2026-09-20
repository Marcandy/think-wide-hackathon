import { HandoffError, verifyHandoffBody } from "../../../core/handoff";
import type { Handoff, ReadHandoffRequest } from "../../../generated/types";

export type HandoffSelection = Pick<
	Handoff,
	"handoffId" | "handoffRevision" | "bodyHash"
>;
export type HandoffReader = (request: ReadHandoffRequest) => Promise<Handoff>;

/** Always re-read via the protected operation at click time. A preview, cached
 * body or correct hash cannot replace a current authorization check.
 */
export async function readHandoffExport(
	selection: HandoffSelection,
	read: HandoffReader,
) {
	const selected = { ...selection };
	const handoff = await verifyHandoffBody(
		await read({
			handoffId: selected.handoffId,
			handoffRevision: selected.handoffRevision,
		}),
	);
	if (
		handoff.handoffId !== selected.handoffId ||
		handoff.handoffRevision !== selected.handoffRevision ||
		handoff.bodyHash !== selected.bodyHash
	) {
		throw new HandoffError(
			"revision_conflict",
			"The saved brief changed; reopen it before exporting",
		);
	}
	if (handoff.audience !== "private_download") {
		throw new HandoffError(
			"capability_disabled",
			"Only private download briefs can be exported here",
		);
	}
	return {
		bodyMarkdown: handoff.bodyMarkdown,
		bodyHash: handoff.bodyHash,
		filename: `think-wide-${handoff.handoffId}-r${handoff.handoffRevision}.md`,
	};
}
