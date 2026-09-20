# Phase 0, initialization, and the clock

## Rules before repository writes

Research checked September 20, 2026. The organizer overview places the build block at 11:10–18:00 EDT. Structured submission dates are 10:00–18:00 EDT. Treat the later advertised build start as the conservative implementation start unless organizers explicitly authorize otherwise. Source: Devpost overview and key-dates actions; official page in [S01](08_SOURCES.md).

The Code Registry floor includes this rule: **"Live in a new public GitHub repository created on 20 September, with hackathon in the repository name"**. The remaining eligibility checks include a working application, the specified README coverage, at least 1,500 source lines in at least ten source files, at least three declared dependencies, and event-window implementation. Its specific instructions reserve the last half-hour for submission/sync and require sync before 18:00; analysis can finish later. The headline about a completed analysis and these specific instructions are not perfectly aligned. Confirm the chosen interpretation with the organizer. Do not pad lines or assume generated/test/vendor line eligibility. [S01]

Bring Your Own Project requires disclosure of pre-existing work and focuses judging on event progress. This documentation is prior design material, even without code. The earlier starter exists; do not copy it or claim it never existed. Record actual use or non-use and any required disclosure. This is a conservative build protocol, not an organizer ruling. [S01]

## Before implementation

Eassa confirms event authority and the real repo location. Marc and Andrew join the same repository, using their own identities. No private source or credentials are needed in the public hackathon repo. Record permitted demonstration repositories, source provenance, team names, and which model/provider budget is approved. Use an existing personal Git login; never share a personal token in chat.

Agree one sentence of acceptance: **two immutable repos, one cross-project discovery, one exact evidence expansion, one retained correction that changes reasoning, one reopened investigation, and one useful implementation brief**. Authenticate one real remote MCP host if its gate passes; do not redefine a local demo as that result.

## Initialization order

1. **Create one checkout and one dependency owner.** Eassa initializes the application during the allowed window. Use one root dependency graph and one lockfile initially. Create only directories being implemented: contracts, core, convex, src/server, src/components, tests, scripts, docs, infra. The diagram is guidance, not a required empty tree.
2. **Emit the first stable interface early.** As part of T01/T02, agree the operation families and core field meanings from 03_TOOLS_AND_MAP.md. Publish that design and the root skeleton promptly, so Marc can theme/render and Andrew can build fixtures. They do not need hosted GitHub or WorkOS to begin.
3. **Resolve and pin real dependencies once.** Bun 1.4.2 and TS7 are candidates requested by the team, not proof all libraries interoperate. Resolve actual packages, check engine/peer constraints, commit the real lock, and require frozen subsequent installs. Do not run three simultaneous lockfile edits. Preserve a compatible checker/compiler-API version where a generator needs it. [S18, S19]
4. **Use official framework initialization during the event.** Prefer TanStack Start/Router plus React; TanStack Form for human input; shadcn primitives and a tweakcn-selected theme. No parallel frontend framework or duplicate application-state cache. Pin/review the registry output and theme export, including any external font requests. [S13, S14]
5. **Generate the mechanical boundary.** Produce public TS shapes and Ajv validators from the authored OpenAPI/schema profile. Curate MCP exposure explicitly. Keep generated clients/descriptor bindings thin; do not build a general code-generation framework. Convex generates its own internal API/data types. See 04_BUILD_CONTRACT.md.
6. **Start local self-hosted Convex.** Use the selected official Docker release, private listeners/volumes, and synthetic data. This remains self-hosting. Do not swap to a different database or to Convex Cloud as an unannounced fix. [S07]
7. **Add first checks and shared branch protection.** Contract drift, types, real-handler tests, and a UI render smoke test. Eassa wires runners; Andrew supplies security assertions; Marc supplies functional tests. If Blacksmith is not connected, use already available GitHub-hosted CI temporarily, recording the runner. Never hold code integration hostage to a runner logo. [S16, S17]
8. **Prove the risk boundaries early.** A tiny installed-package import probe and a real round trip for MCP, renderer, and WorkOS→Convex. Documentation, package export, compile success, local protocol success, and actual host success are separate evidence levels.

## Fixed checkpoints

| Time | Required observable result | Cut/fallback if missed |
|---|---|---|
| 12:30 | Shared repo/lock, codegen, local Convex, render/theme baseline, CI entry | Remote deployment leaves critical path. Keep the local state and selected contract. Drop extra packages, not access checks. |
| 13:30 | Exact source read through real domain authorization; hosted identity if proven | Use a separately gated loopback/stdio local demo with owner-selected public/synthetic sources. Hosted identity remains NOT RUN. No anonymous public endpoint. |
| 14:15 | Two actual immutable Git snapshots and at least one working search mode | Freeze a blocked live GitHub connector. Use permissioned local Git snapshots; retain exact bytes, not an invented code fixture presented as history. |
| 15:00 | Question → evidence → correction → changed result → reopen | Preserve first working recording and commit/config. If unavailable, stop optional integrations and concentrate on the missing core link. A mock does not pass this gate. |
| 15:30 | Downloadable/copyable implementation brief with exact references | If issue POST is unready, export its exact reviewed body. No claim that an issue was created. |
| 16:00 | Feature freeze | No new dependencies, host types, schemas, UI primitives, or optional modes. Fix and integrate existing behavior only. |
| 16:20 | Updated recording if better | Keep the 15:00 recording untouched. Record changed commit/config/modes. |
| 16:30 | Full rehearsal of the selected final path | Disable broken optional capabilities and disclose the deployed/local/recorded status. |
| 17:00 | README, credits, evidence, demo, submission readiness | Stop optional polish; verify the submitted commit and selected track requirements. |
| 17:30 | Code Registry build stop if entering that track | No further implementation. Begin final sync/submission operations. |
| Before 18:00 | Required submission and TCR sync started if applicable | Record actual result/time. No fabricated acceptance or backdating. |

The 12:30, 13:30, 14:15, 15:00, 15:30, 16:00, 16:20, 16:30, and 17:00 checkpoints are team policy. The event-window and TCR constraints are organizer material. Do not blur the two.

## Three-person capacity

Timeboxes in 07_TICKETS.md bound an attempt; they are not estimates guaranteed to succeed. Core ticket allocations total less than the available three-person build window, but reviews, integrations, PM attention, breaks, and environment failures consume the remainder. Optional integration tickets compete for that remainder. Never schedule every optional ticket as though a fourth engineer exists.

Use parallel artifact handoffs, not all-or-nothing phase completion: publish the root skeleton, then the contract/fixtures, then the protected read. No person waits for a finished complete backend. A READY ticket must identify its actual usable prerequisite, even if another part of the preceding phase is incomplete.

## Real package/API proof

Record package version/integrity, official reference, inspected export, smallest relevant compile/runtime check, and pass/fail. For MCP, include chosen protocol profile and actual host. For A2UI, include catalog renderer/profile. For Convex, include the genuine accepted token's issuer/audience mapping, without recording the token. After one failed documented route, stop and use its bounded fallback instead of repeated speculative imports.

A compatible subset is better than invented support. Node can remain the gateway runtime while Bun handles installation/build scripts. TS7 checking does not require every generator to adopt a nonexistent or incompatible compiler API.
