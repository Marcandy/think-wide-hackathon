// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Decision } from "../../generated/types";
import {
	appendDecisionPage,
	decisionCommand,
	operationError,
	workbenchError,
} from "../../src/components/behavior/workbench";
import { PRINCIPAL_A, PRINCIPAL_B } from "../fixtures/identities";

const modules = import.meta.glob("../../convex/**/*.ts");
const identity = {
	subject: PRINCIPAL_A.subject,
	issuer: PRINCIPAL_A.issuer,
	tokenIdentifier: `${PRINCIPAL_A.issuer}|${PRINCIPAL_A.subject}`,
};

async function setup() {
	const t = convexTest(schema, modules);
	const actor = t.withIdentity(identity);
	await t.run((ctx) =>
		ctx.db.insert("grants", {
			principal: identity.tokenIdentifier,
			resourceKind: "snapshot",
			resourceId: "snapshot_alpha",
			role: "owner",
			epoch: 1,
		}),
	);
	const investigation = await actor.mutation(
		api.investigations.openInvestigation,
		{
			request: {
				question: "Keep durable human direction",
				snapshotIds: ["snapshot_alpha"],
				requestKey: "t09-open-request",
			},
		},
	);
	return { t, actor, investigation };
}

describe("T09 workbench commands against real protected handlers", () => {
	test("a fresh reader sees correction and prior rejection exactly as saved", async () => {
		const { t, actor, investigation } = await setup();
		const first = decisionCommand(
			investigation,
			{
				kind: "correction",
				statement: "Keep exact CRLF\r\nand Unicode: café.  ",
			},
			"t09-correction-1",
		);
		const correction = await actor.mutation(api.decisions.recordDecision, {
			request: first,
		});
		const rejection = await actor.mutation(api.decisions.recordDecision, {
			request: decisionCommand(
				{ ...investigation, revision: 1 },
				{ kind: "rejection", statement: "Do not run target repository code." },
				"t09-rejection-2",
			),
		});
		const reopened = await t
			.withIdentity(identity)
			.query(api.investigations.readInvestigation, {
				request: { investigationId: investigation.investigationId },
			});
		expect(reopened.revision).toBe(2);
		expect(appendDecisionPage([], reopened, reopened)).toEqual([
			correction,
			rejection,
		]);
		expect(reopened.decisions?.[0].statement).toBe(first.statement);
		expect(
			await actor.mutation(api.decisions.recordDecision, { request: first }),
		).toEqual(correction);
		expect(
			await t.run((ctx) => ctx.db.query("decisions").collect()),
		).toHaveLength(2);
	});

	test("a stale draft is rejected without overwriting or losing the saved decision", async () => {
		const { actor, investigation } = await setup();
		const stale = decisionCommand(
			investigation,
			{ kind: "correction", statement: "My unsaved correction" },
			"t09-stale-draft",
		);
		await actor.mutation(api.decisions.recordDecision, {
			request: decisionCommand(
				investigation,
				{ kind: "rejection", statement: "Other writer’s rejection" },
				"t09-other-writer",
			),
		});
		const error = await actor
			.mutation(api.decisions.recordDecision, { request: stale })
			.catch((failure: unknown) => failure);
		expect(operationError(error)).toMatchObject({
			code: "revision_conflict",
			currentRevision: 1,
		});
		expect(workbenchError(error)).toContain("Your draft is unchanged");
		expect(stale.expectedRevision).toBe(0);
		const reopened = await actor.query(api.investigations.readInvestigation, {
			request: { investigationId: investigation.investigationId },
		});
		expect(reopened.decisions).toHaveLength(1);
		expect(reopened.decisions?.[0].kind).toBe("rejection");
	});

	test("reads all 70 decisions across actual bounded pages, with no duplicated history", async () => {
		const { actor, investigation } = await setup();
		for (let revision = 0; revision < 70; revision++)
			await actor.mutation(api.decisions.recordDecision, {
				request: decisionCommand(
					{ ...investigation, revision },
					{
						kind: revision % 2 ? "rejection" : "constraint",
						statement: `Decision ${revision + 1}`,
					},
					`t09-page-${revision}`,
				),
			});
		let cursor: string | undefined;
		let decisions: Decision[] = [];
		let pages = 0;
		do {
			const page = await actor.query(api.investigations.readInvestigation, {
				request: {
					investigationId: investigation.investigationId,
					...(cursor ? { cursor } : {}),
				},
			});
			decisions = appendDecisionPage(decisions, page, {
				...investigation,
				revision: 70,
			});
			cursor = page.page?.nextCursor ?? undefined;
			pages++;
		} while (cursor);
		expect(pages).toBeGreaterThan(1);
		expect(decisions).toHaveLength(70);
		expect(decisions[69].statement).toBe("Decision 70");
	});

	test("refuses a mixed revision page and an incomplete final page", async () => {
		const { actor, investigation } = await setup();
		await actor.mutation(api.decisions.recordDecision, {
			request: decisionCommand(
				investigation,
				{ kind: "constraint", statement: "Must survive" },
				"t09-page-mismatch",
			),
		});
		const page = await actor.query(api.investigations.readInvestigation, {
			request: { investigationId: investigation.investigationId },
		});
		expect(() => appendDecisionPage([], page, investigation)).toThrow(
			"revision changed",
		);
		expect(() =>
			appendDecisionPage([], { ...page, decisions: [] }, page),
		).toThrow("history is incomplete");
	});

	test("foreign and missing investigations have the same visible error; revocation denies receipt replay", async () => {
		const { t, actor, investigation } = await setup();
		const request = decisionCommand(
			investigation,
			{ kind: "constraint", statement: "Private decision" },
			"t09-private-save",
		);
		await actor.mutation(api.decisions.recordDecision, { request });
		const stranger = t.withIdentity({
			subject: PRINCIPAL_B.subject,
			issuer: PRINCIPAL_B.issuer,
		});
		const messages = [];
		for (const investigationId of [
			investigation.investigationId,
			"missing_investigation",
		])
			messages.push(
				await stranger
					.query(api.investigations.readInvestigation, {
						request: { investigationId },
					})
					.catch(workbenchError),
			);
		expect(messages).toEqual([
			"Investigation unavailable.",
			"Investigation unavailable.",
		]);
		await t.run(async (ctx) => {
			for (const grant of await ctx.db.query("grants").collect())
				await ctx.db.patch(grant._id, { revokedAt: 200 });
		});
		const error = await actor
			.mutation(api.decisions.recordDecision, { request })
			.catch((failure: unknown) => failure);
		expect(operationError(error)?.code).toBe("not_found");
	});

	test("validates through the generated contract and does not reveal transport payloads", async () => {
		const { investigation } = await setup();
		expect(() =>
			decisionCommand(
				investigation,
				{ kind: "constraint", statement: "   " },
				"t09-empty-decision",
			),
		).toThrow();
		expect(() =>
			decisionCommand(
				investigation,
				{ kind: "constraint", statement: "x".repeat(16385) },
				"t09-long-decision",
			),
		).toThrow();
		expect(workbenchError(new Error("secret-provider-payload"))).not.toContain(
			"secret-provider-payload",
		);
	});
});
