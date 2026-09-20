# Repo map: exact paths

Where every file goes. **EXISTS** = in the repo now. **TOOL** = created by a scaffold command, do not hand-write. **Txx** = written by that ticket. Names marked TOOL may differ slightly by scaffold version; keep what the tool emits.

Import rule: `convex/` and `src/server/` may import `core/` and `generated/`. `convex/` never imports `src/`. `src/` reaches Convex only through `convex/_generated/api`. `core/` imports nothing but `generated/`.

## Root

| Path | Source |
|---|---|
| `.gitattributes` `.gitignore` `.env.example` | EXISTS |
| `README.md` `LICENSE` `CLAUDE.md` (agent instructions, shared by all three) | T01 |
| `package.json` `tsconfig.json` `vite.config.ts` | TOOL: TanStack Start scaffold |
| `bun.lock` | TOOL: `bun install` (only Eassa changes deps) |
| `components.json` | TOOL: `bunx shadcn@latest init` |
| `.env.local` | local only, gitignored, copied from `.env.example` |

## `contracts/` hand-written public contract (T02, Eassa)

```
contracts/openapi.yaml                      all operations, OpenAPI 3.1
contracts/operations.registry.ts            operationId -> handler, exposure(http|mcp), effect class, approval, projection
contracts/schemas/source-ref.schema.json    repo + commit + blob + entryId + byte range + digest
contracts/schemas/envelope.schema.json      scope, kind, entries, coverage, cursor, freshness, truncation
contracts/schemas/capabilities.schema.json
contracts/schemas/project.schema.json
contracts/schemas/snapshot-entry.schema.json
contracts/schemas/finding.schema.json
contracts/schemas/investigation.schema.json
contracts/schemas/decision.schema.json
contracts/schemas/proposal.schema.json
contracts/schemas/run.schema.json
contracts/schemas/handoff.schema.json
contracts/schemas/composition.schema.json   UI catalog composition (16 nodes, depth 4, 32 KiB)
```

## `generated/` output of `scripts/codegen.ts`, committed, never edited

```
generated/types.ts
generated/validators.js
generated/validators.d.ts
generated/operations.ts
```

## `core/` pure TypeScript rules (T06 Eassa, reviewed by Andrew)

```
core/index.ts
core/principal.ts      verified identity -> principal; never from request fields
core/grants.ts         object authorization, grant epoch
core/source-ref.ts     exact reference identity + digest check
core/revision.ts       investigation revision N -> N+1, stale fencing
core/receipts.ts       actor + operation + resource + request key + argument digest
core/decisions.ts      correction / constraint / rejection
core/handoff.ts        frozen brief revision, body hash, deterministic Markdown
core/audience.ts       destination visibility vs consumed sources
core/limits.ts         20 hits, 100 children, 16 KiB windows, scan caps
```

## `convex/` backend state (TOOL creates the folder; files by ticket)

```
convex/_generated/            TOOL: bunx convex dev
convex/tsconfig.json          TOOL
convex/schema.ts              T02
convex/auth.config.ts         T02 scaffold, I01 real issuer/JWKS/audience
convex/lib/authz.ts           T06  shared "who is calling + may they touch this object"
convex/projects.ts            T05  listProjects
convex/snapshots.ts           T05  browseSnapshot, entry index
convex/sourceCache.ts         T05  exact-byte cache by repo/snapshot/blob
convex/findings.ts            T07
convex/investigations.ts      T06  openInvestigation, readInvestigation
convex/decisions.ts           T06  recordDecision
convex/proposals.ts           T10  submitProposal, internal publication mutation
convex/runs.ts                T10  requestAnalysis, getRun, cancelRun
convex/handoffs.ts            T09  prepareHandoff, readHandoff
convex/receipts.ts            T06
convex/actions/reasoning.ts   T10  "use node" internal action, one model call
```

## `src/` web app + trusted Node server

```
src/router.tsx                          TOOL
src/routeTree.gen.ts                    TOOL (generated, committed)
src/routes/__root.tsx                   TOOL, then T03
src/routes/index.tsx                    T09  portfolio
src/routes/projects.$projectId.tsx      T09
src/routes/investigations.$investigationId.tsx   T09
src/routes/handoffs.$handoffId.tsx      T09
src/routes/workshop.tsx                 T03  component workshop
src/routes/callback.tsx                 I01  WorkOS redirect
src/routes/api/ops.$operationId.ts      T08  HTTP adapter
src/routes/api/mcp.ts                   T08  MCP streamable HTTP endpoint

src/lib/utils.ts                        TOOL: shadcn
src/components/ui/*                     TOOL: shadcn add
src/components/catalog/EvidencePair.tsx        T03
src/components/catalog/ConnectionCard.tsx      T03
src/components/catalog/ConstraintEditor.tsx    T03
src/components/catalog/HandoffPreview.tsx      T03
src/components/catalog/Stack.tsx               T03
src/components/catalog/Section.tsx             T03
src/components/catalog/registry.ts             T03  closed component list
src/components/catalog/validate-composition.ts T03
src/components/shell/PortfolioNav.tsx          T09
src/components/shell/SourceViewer.tsx          T09
src/components/shell/AuthIndicator.tsx         I01
src/components/shell/ApprovalDialog.tsx        I03
src/styles/theme.css                    T03  tweakcn export, tokens only
src/styles/globals.css                  T03  mappings, separate from tokens

src/server/config.ts                    T02  mode: local-demo | connected; refuse local-demo in production
src/server/convex-client.ts             T06  request-scoped client, no global authed client
src/server/ops/dispatch.ts              T08  one path: validate -> authorize -> handler (HTTP + MCP + CLI)
src/server/ops/handlers/*.ts            T05..T09  one file per operationId
src/server/mcp/server.ts                T08
src/server/mcp/tools.ts                 T08  built from generated/operations.ts, explicit exposure only
src/server/auth/workos.ts               I01
src/server/auth/verify-token.ts         I01  issuer, JWKS, audience
src/server/git/snapshot.ts              T05  resolve ref once -> full commit id
src/server/git/tree.ts                  T05  git ls-tree -z
src/server/git/read-blob.ts             T05  git cat-file, byte ranges, digest
src/server/git/history.ts               T05  bounded log/diff
src/server/search/literal.ts            T07  fixed-string over immutable bytes
src/server/search/structural.ts         T07  ast-grep, no rewrite flags, clean env, time/output caps
src/server/search/rules/*.yml           T07  reviewed rules
src/server/guidance/recipes/*.md        T07  readGuidance content
src/server/github/app.ts                I02
src/server/github/publish-issue.ts      I03
```

## `tests/` (Andrew; file names carry the acceptance ID from 05_SECURITY_AND_CI.md)

```
tests/fixtures/identities.ts            T04  principals A and B
tests/fixtures/repos/                   T04  two real git repos as .bundle files (byte-exact, see .gitattributes)
tests/fixtures/expectations.ts          T04  independent permission expectations
tests/helpers/effects.ts                T04  observe db/job/provider effects
tests/boundary/q01-cross-tenant.test.ts
tests/boundary/q02-token-profiles.test.ts
tests/boundary/q03-nested-refs-cursors.test.ts
tests/domain/q04-exact-bytes.test.ts
tests/domain/q05-search.test.ts
tests/domain/q06-stale-proposal.test.ts
tests/domain/q07-duplicate-command.test.ts
tests/adapter/q08-catalog-composition.test.ts
tests/boundary/q10-injection.test.ts
tests/boundary/q13-analyzer-confinement.test.ts
tests/adapter/q14-same-policy-all-surfaces.test.ts
tests/browser/smoke.test.ts             T03
tests/e2e/q15-full-loop.test.ts         T11
```

## `scripts/` `infra/` `.github/`

```
scripts/codegen.ts                      T02  openapi -> generated/, no model calls
scripts/check-drift.ts                  T02  generate twice into clean dirs, diff
scripts/check.ts                        T01  frozen install -> codegen drift -> typecheck -> tests (same entry local + CI)
scripts/make-fixture-repos.ts           T04

infra/docker-compose.yml                EXISTS  Convex pinned by digest, 127.0.0.1 only
infra/Caddyfile                         I04
infra/docker-compose.prod.yml           I04
infra/DEPLOY.md                         I04  ports, volumes, SSH recovery

.github/workflows/ci.yml                T01  calls scripts/check.ts, actions pinned by SHA
.github/CODEOWNERS                      T01  contracts/ core/ convex/auth.config.ts .github/ infra/ -> Eassa + reviewer
```

## `docs/`

```
docs/*.md, docs/roles/, docs/tickets/   EXISTS  the plan (prior design material, disclosed)
docs/REPO_MAP.md                        EXISTS  this file
docs/G0_EVENT_RECORD.md                 G0   track, build window, organizer ruling, disclosure
docs/decisions/                         short dated notes for contract/architecture changes
docs/evidence/                          sanitized receipts per ticket / Q-case
```
