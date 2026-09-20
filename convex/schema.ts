import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Public documents are JSON validated by generated validators on every read/write.
// Storage metadata is separate, avoiding a second handwritten public schema.
export default defineSchema({
	grants: defineTable({
		principal: v.string(),
		resourceKind: v.union(v.literal("investigation"), v.literal("snapshot")),
		resourceId: v.string(),
		role: v.union(v.literal("owner"), v.literal("reader")),
		epoch: v.number(),
		revokedAt: v.optional(v.number()),
	}).index("by_principal_resource", [
		"principal",
		"resourceKind",
		"resourceId",
	]),
	investigations: defineTable({ body: v.string(), cursorSecret: v.string() }),
	decisions: defineTable({
		investigationId: v.id("investigations"),
		resultingRevision: v.number(),
		body: v.string(),
	}).index("by_investigation_revision", [
		"investigationId",
		"resultingRevision",
	]),
	receipts: defineTable({
		principal: v.string(),
		operationId: v.string(),
		requestKey: v.string(),
		digest: v.string(),
		resultKind: v.union(
			v.literal("investigation"),
			v.literal("decision"),
			v.literal("run"),
		),
		resultId: v.string(),
	}).index("by_principal_operation_key", [
		"principal",
		"operationId",
		"requestKey",
	]),
	runs: defineTable({
		investigationId: v.id("investigations"),
		baseRevision: v.number(),
		principal: v.string(),
		body: v.string(),
		fences: v.array(v.object({ grantId: v.id("grants"), epoch: v.number() })),
	}),
});
