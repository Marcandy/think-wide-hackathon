# 0003: Decision categories are a second axis, not new kinds

Date: 2026-09-20 · Proposed by Marc · Accepted by Eassa · Tracking: issue #14 · Contract part ships in 0.2.0 (issue #10)

## Decision
A decision has two independent axes. `kind` is the **action** (correction, constraint, rejection, acceptance) and it changes behavior: every kind advances the investigation revision. `category` is the **subject** and only describes. Add one optional `category` per decision with a closed vocabulary, `architecture | security`. Absent means uncategorized; the field is omitted on the wire, never `null`.

`category` is added to `Decision`, `RecordDecisionRequest`, and `HandoffConstraint`, so an exported implementation brief carries it structurally ("Security constraint: never log authentication tokens").

## Why this shape
- Putting "security" into `kind` would mix a behavioral switch with a label. The next label would do it again.
- Closed vocabulary beats free text: agents and the brief can filter on it, and validators reject typos. Adding a value later is an additive one-line contract change.
- One category, not a list: a list needs ordering and uniqueness rules in the receipt digest for no demonstrated need.
- It is never inferred from the statement and never normalized. A human chose it or it is absent.
- It is user metadata. It is not a role, a trust label, or a security guarantee, and it never affects authorization.
- It is not part of `composition.schema.json`. A human's draft lives outside model-generated layout, so a regenerated `ConstraintEditor` cannot overwrite it.

## What the existing design already gives us (checked against PR #12)
- **Storage:** decisions are JSON bodies validated by the generated validators. `convex/schema.ts` does not change.
- **Idempotency:** the receipt digest hashes the whole validated request. Same key with a changed category, or omitted versus present, is already `request_key_conflict`.
- **Authorization and replay:** unchanged; the operation pipeline re-checks grants on replay.
- **The one real risk:** `convex/decisions.ts` builds the stored decision field by field, so without a handler change a validated `category` would be silently dropped. The handler passes it through with a conditional spread, and a real-handler test asserts store-and-return.

## Not decided here
More vocabulary; multiple categories; retagging an existing decision (history is append-only, so that needs its own command semantics); backfill of existing decisions (none proposed). No version negotiation: there are no external clients, every consumer compiles from the same `generated/` in the same commit.

## Order
Contract with #10 → backend one-liner after PR #12 merges → UI after T03 (PR #13) merges → end-to-end (reload, brief export) after T09. Labeled `optional`: it is not on the path to the first complete loop.
