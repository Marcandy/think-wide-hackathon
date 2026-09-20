# 0001: JSON Schemas + operations.json are the canonical contract

Date: 2026-09-20 · Owner: Eassa · Status: accepted · Supersedes the "authored OpenAPI" wording in 04_BUILD_CONTRACT.md

## Decision
The public contract is authored as JSON Schema 2020-12 files in `contracts/schemas/` plus one operation registry, `contracts/operations.json`. `scripts/codegen.ts` generates `generated/{types.ts,validators.js,validators.d.ts,operations.ts}`. There is no hand-written `contracts/openapi.yaml` and no `contracts/operations.registry.ts`. If HTTP documentation is needed, an OpenAPI document is emitted from the registry; it is never a second source.

## Why
04_BUILD_CONTRACT.md allows a reviewed adjustment when installed tools require it. One source feeds five consumers with the tools actually installed: Ajv strict validators, TypeScript types, the operation pipeline (0002), MCP tool input schemas, and the drift check. A hand-written OpenAPI file would be a second copy of the same nested shapes.

## Rules that follow
- `generated/` is committed and only ever regenerated (`bun run codegen`). `bun run verify` fails on drift.
- Generated validators are ESM with no `require(`; generation throws otherwise.
- A new operation is not agent-exposed unless `"mcp"` is in its `exposure` list.
- Identity is never a request field. Every request schema is `additionalProperties: false`.
- Operations that return the result envelope declare `envelopeKind`; the pipeline rejects a response whose `kind` differs.
- Every integration in `getCapabilities` reports an explicit status. Unproven means `not_run`, never absent.
- Contract 0.1.0 froze at `2bb940f` (PR #6). The current version is **0.2.0** (issue #10). It is 0.2.0 rather than 0.1.1 because response shapes change.
- The registry carries handler bindings and typed operation maps; adapters and wrappers consume them rather than restating them. An operation's optional `handler` is `"<convexModule>:<exportName>"`; `generated/operations.ts` exports `OperationRequestMap`, `OperationResponseMap`, `ReadOperationId` / `StateOperationId` / `ExternalOperationId`, `OPERATION_HANDLERS`, `ImplementedOperationId` and `UNIMPLEMENTED_OPERATIONS`. `convex/lib/operation.ts` takes its request/response types and effect unions from there. `tests/domain/operation-handlers.test.ts` fails if a handler does not name a real exported `operation.query(` (read) or `operation.mutation(` (state) registration with the same operationId, if two operations share a handler, or if a public registration is left unbound.
- `docs/OPERATIONS.md` is printed from `generated/operations.ts` by `scripts/operations-doc.ts`. It is never edited; `scripts/check-drift.ts` fails the gate when it is stale.

## What changed in 0.2.0
- **Object id length is bound to `hashAlgorithm`.** `SourceRef` (`commit`, `blobId`) and `SnapshotSummary` (`commit`, `rootTreeId`): `sha1` requires exactly 40 hex characters, `sha256` exactly 64, expressed as `if`/`then`/`else` so the generated `SourceRef` type stays a single interface. `hashAlgorithm` names the Git object format of those ids; `digest` is always sha256 and has its own field. T07's search had conflated the two (it stamped `sha256` on 40-hex ids) and was corrected when the constraint landed. `HandoffTarget.baseCommit` has no `hashAlgorithm` beside it and keeps the 40-or-64 pattern.
- **`Capabilities.searchModes` lists only invocable modes**: `literal`, `structural`. A mode is re-added together with its `SearchSourcesRequest` branch.
- **Decision categories** (decision 0003, issue #14): `common.schema.json#/$defs/DecisionCategory` = `architecture | security`; optional `category` on `Decision`, `RecordDecisionRequest` and `HandoffConstraint`. Never required, never `null`, nothing in `composition.schema.json`. `recordDecision` stores and returns it.
- **`recipe.schema.json`** is the entry schema for `readGuidance` (T07, PR #15).
- **Registry**: optional `handler` per operation; generated typed maps and effect unions (rule above).
- **`scripts/check-drift.ts` recurses** into `generated/`, treats a file/directory mismatch or an extra path as drift, and checks `docs/OPERATIONS.md`.

## Open items carried by their owning tickets
| Item | Owner | Interim rule |
|---|---|---|
| `readHandoff` needs an exact ranged body read (brief up to 64K chars vs 16 KiB result cap) | T09 | `prepareHandoff` refuses an over-cap brief with `limit_exceeded`. Never truncate. |
| Entry schema for `readHistory` | T05 | `entriesType: null` until the git reader defines the commit record |
| Reject inverted byte/line ranges | T05 `readSource` handler | JSON Schema cannot express end >= start |
| Source refs are authorized by snapshot membership but not checked for existence (PR #12 review) | T05 integration (#11) | stored refs are *authorized, not verified*; findings stay `verification: "unverified"` |
| `src/server/config.ts` (mode, refuse local-demo in production) | T02 part 2 | — |
| `ScanEntry` (T07 search input) carries no `hashAlgorithm`; search derives it from the commit id length | T05, when it produces real entries | a ref whose `commit` and `blobId` lengths disagree is rejected by the validator |

## Closed in 0.2.0
- [x] Object id length must match `hashAlgorithm` (issue #10). The T05 git reader should still reject a mismatch early with `invalid_request`; the validators now reject it regardless.
- [x] `searchModes` no longer lists `semantic` / `type` (issue #10).
- [x] Optional `category` on `Decision`, `RecordDecisionRequest`, `HandoffConstraint` (issue #14 parts 1 and 2). UI (part 3) and end-to-end (part 4) remain with issue #14.
- [x] Entry schema for `readGuidance` (T07, PR #15).
- [x] `scripts/check-drift.ts` recurses.
