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
- Contract 0.1.0 froze at `2bb940f` (PR #6). Later changes are 0.1.x follow-ups with a one-line note here.

## Open items carried by their owning tickets
| Item | Owner | Interim rule |
|---|---|---|
| `readHandoff` needs an exact ranged body read (brief up to 64K chars vs 16 KiB result cap) | T09 | `prepareHandoff` refuses an over-cap brief with `limit_exceeded`. Never truncate. |
| Entry schema for `readHistory` | T05 | `entriesType: null` until the git reader defines the commit record |
| Entry schema for `readGuidance` | T07 | same, defined with the first recipe |
| Reject inverted byte/line ranges | T05 `readSource` handler | JSON Schema cannot express end >= start |
| `scripts/check-drift.ts` should recurse | T02 part 2 | `generated/` is flat today |
| `src/server/config.ts` (mode, refuse local-demo in production) | T02 part 2 | — |
