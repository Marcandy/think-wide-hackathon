import {
	useConvex,
	useConvexConnectionState,
	useMutation,
	useQuery,
} from "convex/react";
import { useId, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type {
	Decision,
	Investigation,
	RecordDecisionRequest,
} from "../../../generated/types";
import {
	appendDecisionPage,
	decisionCommand,
	decisionLabels,
	isDecisionKind,
	operationError,
	workbenchError,
} from "./workbench";

const control =
	"rounded-md border border-input bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const button = `${control} cursor-pointer disabled:cursor-not-allowed`;

export function InvestigationWorkbench({
	investigationId,
}: {
	investigationId: string;
}) {
	const client = useConvex();
	const connection = useConvexConnectionState();
	const recordDecision = useMutation(api.decisions.recordDecision);
	// A live authorized query owns the visible revision and removes the view if
	// access is revoked. No localStorage, fixture principal, or parallel state store.
	const investigation = useQuery(api.investigations.readInvestigation, {
		request: { investigationId },
	});
	const fieldId = useId();
	const [draft, setDraft] = useState<
		Pick<RecordDecisionRequest, "kind" | "statement">
	>({ kind: "constraint", statement: "" });
	const [baseRevision, setBaseRevision] = useState<number>();
	const [pending, setPending] = useState<RecordDecisionRequest>();
	const [saving, setSaving] = useState(false);
	const inFlight = useRef(false);
	const [message, setMessage] = useState("");
	const [pageError, setPageError] = useState("");
	const [loadingPage, setLoadingPage] = useState(false);
	const [history, setHistory] = useState<{
		base: Investigation;
		decisions: Decision[];
		cursor: string | null;
	}>();
	if (!connection.isWebSocketConnected) {
		return (
			<output>
				Connecting to the investigation service… Saved content will appear when
				the connection is available.
			</output>
		);
	}
	if (!investigation) {
		return <output>Loading investigation…</output>;
	}
	// An updated authorized result invalidates previously fetched pages even when
	// the revision is unchanged (e.g. a proposal or grant change).
	const activeHistory = history?.base === investigation ? history : undefined;
	const decisions = activeHistory?.decisions ?? investigation.decisions ?? [];
	const cursor = activeHistory
		? activeHistory.cursor
		: investigation.page?.nextCursor;
	const staleDraft =
		baseRevision !== undefined && baseRevision !== investigation.revision;

	async function save() {
		if (!investigation || inFlight.current) {
			return;
		}
		let request: RecordDecisionRequest;
		try {
			request =
				pending ??
				decisionCommand(
					{ investigationId, revision: baseRevision ?? investigation.revision },
					draft,
					crypto.randomUUID(),
				);
		} catch {
			setMessage(
				"Write a decision within the 16,384 character limit before saving.",
			);
			return;
		}
		inFlight.current = true;
		setSaving(true);
		setPending(request);
		setMessage("");
		try {
			const saved = await recordDecision({ request });
			setDraft({ kind: draft.kind, statement: "" });
			setBaseRevision(undefined);
			setPending(undefined);
			setMessage(
				`Decision saved at revision ${saved.resultingRevision}. It will remain when you reopen this investigation.`,
			);
		} catch (error) {
			setMessage(workbenchError(error));
			// Known operation failures roll back the transaction. A transport failure
			// may follow a committed write: keep the exact request/key for replay.
			if (operationError(error)) {
				setPending(undefined);
			}
		} finally {
			inFlight.current = false;
			setSaving(false);
		}
	}

	async function loadMore() {
		if (!investigation || !cursor || loadingPage) {
			return;
		}
		setLoadingPage(true);
		setPageError("");
		try {
			const page = await client.query(api.investigations.readInvestigation, {
				request: { investigationId, cursor },
			});
			setHistory({
				base: investigation,
				decisions: appendDecisionPage(decisions, page, investigation),
				cursor: page.page?.nextCursor ?? null,
			});
		} catch {
			setHistory(undefined);
			setPageError(
				"Could not load more history. The investigation may have changed; retry from the current page.",
			);
		} finally {
			setLoadingPage(false);
		}
	}

	return (
		<div className="space-y-8">
			<header className="space-y-3">
				<p className="text-sm text-muted-foreground">
					Investigation · revision {investigation.revision}
				</p>
				<h1 className="whitespace-pre-wrap break-words text-3xl font-semibold">
					{investigation.question}
				</h1>
				<p className="text-sm">
					Saved decisions belong to this investigation. No model call is needed
					to record your judgment.
				</p>
			</header>
			<div className="grid gap-6 lg:grid-cols-2">
				<section
					className="space-y-4 rounded-lg border bg-card p-5"
					aria-labelledby={`${fieldId}-heading`}
				>
					<h2 id={`${fieldId}-heading`} className="text-xl font-semibold">
						Record your decision
					</h2>
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<fieldset disabled={saving || !!pending} className="space-y-4">
							<div className="grid gap-2">
								<label htmlFor={`${fieldId}-kind`}>Decision action</label>
								<select
									id={`${fieldId}-kind`}
									className={control}
									value={draft.kind}
									onChange={(event) => {
										if (isDecisionKind(event.target.value)) {
											setDraft({ ...draft, kind: event.target.value });
											setBaseRevision(baseRevision ?? investigation.revision);
										}
									}}
								>
									{Object.entries(decisionLabels).map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</div>
							<div className="grid gap-2">
								<label htmlFor={`${fieldId}-statement`}>Your direction</label>
								<textarea
									id={`${fieldId}-statement`}
									className={`${control} min-h-36`}
									rows={5}
									maxLength={16384}
									required
									value={draft.statement}
									aria-describedby={`${fieldId}-draft-help`}
									onChange={(event) => {
										setDraft({ ...draft, statement: event.target.value });
										setBaseRevision(baseRevision ?? investigation.revision);
									}}
								/>
								<p
									id={`${fieldId}-draft-help`}
									className="text-sm text-muted-foreground"
								>
									Saved decisions survive reopening. Unsaved drafts stay here
									until you navigate away or reload.
								</p>
							</div>
						</fieldset>
						{staleDraft && !pending ? (
							<div className="space-y-2">
								<p>
									A newer revision is available. Review the saved history before
									applying your draft.
								</p>
								<button
									type="button"
									className={button}
									onClick={() => {
										setBaseRevision(investigation.revision);
										setMessage("");
									}}
								>
									I reviewed revision {investigation.revision}
								</button>
							</div>
						) : null}
						<button
							className={button}
							type="submit"
							disabled={
								saving || (!pending && (staleDraft || !draft.statement.trim()))
							}
						>
							{saving
								? "Saving…"
								: pending
									? "Retry the same save"
									: "Save decision"}
						</button>
						<output aria-live="polite" className="block text-sm">
							{message}
						</output>
					</form>
				</section>
				<section
					className="space-y-4 rounded-lg border bg-card p-5"
					aria-labelledby={`${fieldId}-history`}
				>
					<h2 id={`${fieldId}-history`} className="text-xl font-semibold">
						Saved decision history
					</h2>
					<p className="text-sm text-muted-foreground">
						Showing {decisions.length} saved decisions
						{cursor ? "; more available" : ""}. Prior decisions remain in the
						ledger.
					</p>
					<ol className="space-y-4">
						{decisions.map((decision) => (
							<li key={decision.decisionId} className="space-y-2 border-t pt-3">
								<p className="font-medium">
									{decisionLabels[decision.kind]} · revision{" "}
									{decision.resultingRevision}
								</p>
								<p className="whitespace-pre-wrap break-words">
									{decision.statement}
								</p>
								{decision.refs?.length ? (
									<p className="text-sm text-muted-foreground">
										{decision.refs.length} source references recorded. Source
										viewing is awaiting the snapshot integration.
									</p>
								) : null}
							</li>
						))}
					</ol>
					{cursor ? (
						<button
							type="button"
							className={button}
							disabled={loadingPage}
							onClick={() => void loadMore()}
						>
							{loadingPage ? "Loading…" : "Load more decisions"}
						</button>
					) : null}
					<output className="block text-sm">{pageError}</output>
				</section>
			</div>
			<section
				className="space-y-3 rounded-lg border bg-card p-5"
				aria-labelledby={`${fieldId}-brief`}
			>
				<h2 id={`${fieldId}-brief`} className="text-xl font-semibold">
					Implementation brief
				</h2>
				<p id={`${fieldId}-export-help`}>
					Brief export will be available when the target snapshot and saved
					brief operations are connected.
				</p>
				<div className="flex flex-wrap gap-3">
					<button
						className={button}
						type="button"
						disabled
						aria-describedby={`${fieldId}-export-help`}
					>
						Prepare private brief
					</button>
					<button
						className={button}
						type="button"
						disabled
						aria-describedby={`${fieldId}-publish-help`}
					>
						Publish GitHub issue
					</button>
				</div>
				<p
					id={`${fieldId}-publish-help`}
					className="text-sm text-muted-foreground"
				>
					GitHub issue publication is not connected.
				</p>
			</section>
		</div>
	);
}
