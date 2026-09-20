# Product and architecture

## What Think-wide is

A scoped repository portfolio workbench and MCP tool service. It lets a person or capable host agent discover prior work, inspect exact evidence, compare applicability, preserve decisions, and hand bounded work to a coding specialist. Its first user is a builder with several repositories, not an operator seeking an autonomous maintenance bot.

Use **Think-wide reasons across projects; coding agents implement inside projects** as the positioning, not a factual claim that coding agents can never navigate multiple repositories. The product value must be demonstrated by better evidence selection, preserved decisions, and useful handoff, not by claiming exclusive reasoning ability.

## Remove the repair branch, not the useful tools

Product operations may inspect authorized Git objects and history, analyze immutable source with trusted bounded parsers/search tools, preserve private application state, export a work brief, and optionally create an approved GitHub issue. They may not execute a caller-supplied shell command, package install, target test script, build script, repository hook, generated plugin, or code edit. No branch/PR creation, merge, deploy, OS administration, or autonomous coding-agent dispatch is in this profile.

Building and testing **Think-wide's own application** is different: the three teammates and their local coding tools must install reviewed app dependencies, run Think-wide tests, commit, review, and deploy under their granted development authority. Cutting product repair does not prohibit ordinary development of Think-wide.

## One small deployment

```text
Owned web                         ChatGPT / Claude.ai / other MCP hosts
    |                                               |
    +------------------- HTTPS ---------------------+
                            |
                       Caddy edge
                            |
                One trusted Node application
                HTTP / MCP / AG-UI adapters
                WorkOS session/token verification
                source/provider broker
                bounded read-only analysis
                            |
                Self-hosted Convex, private
                domain queries and mutations
                internal provider/model actions
                application state and indexes
                optional exact-byte cache

External services: WorkOS; selected Git provider;
                   model API only for admitted backend reasoning.
Operator-only: SSH, dashboard, deploy/backup credentials.
Coding agents: outside this runtime, receive a brief and own their work.
```

The read-only analyzer can be a constrained child process or short-lived worker with a read-only selection of source and no provider secrets. It is not a general repair executor. Native analysis still parses untrusted bytes, so resource limits and confinement remain important.

The first-party interface and server routes may share the same application deployment. Do not create separate microservices for MCP, the Git connector, every search mode, or the PM. Convex is the only application-state database. No extra graph/vector database or event bus is required.

## One policy path

HTTP, MCP, and any CLI call the same operation handler and authorization rules. Convex verifies the configured caller profile; domain functions derive principal from verified identity and check current resource grants and revisions. A gateway-only network plan is not a substitute for those checks.

Use request-scoped user clients. No global mutable authenticated client and no deployment admin key for ordinary user requests. The gateway and Convex must deliberately agree on the protected-resource/token profile; native AuthKit and Connect tokens are not interchangeable by assumption. See 05_SECURITY_AND_CI.md.

## Two valid reasoning drivers, never two competing writers

**Host-directed:** a capable MCP host selects sources and calls Think-wide tools, submits a tentative evidence-backed comparison, and proposes a valid display. The user-facing host supplies the model. No automatic second model call is necessary.

**Backend-directed:** an admitted bounded run invokes one configured model using the same tools/operations and evidence rules; useful for the owned web. Its permissions and spend are explicit. A hidden second layout/planning model is not part of the design.

An investigation revision admits one current writer/run for a proposal. Human corrections advance revision and fence stale publications. Another agent can read or start a separate investigation; it cannot overwrite a competing accepted result silently. Catalog UI can be rendered in the owned web and a tested MCP App shell; a host with only tools still gets structured results and ordinary text.

## Data, not a framework for every noun

| Stored family | Responsibility |
|---|---|
| Identities/connections/grants | Verified subjects, selected provider access, current permission/revocation state |
| Repositories/snapshots/entries | Navigable metadata over exact Git tree identities |
| Findings | Observed structural facts, source-reported claims, tentative relations and provenance |
| Investigations/decisions | Scope, current question/revision, explicit human constraints and prior rejections |
| Runs/receipts | Admitted work, current epoch/revision, sanitized outcomes, duplicate-effect controls |
| Handoffs | Immutable reviewed brief revision, intended destination/audience, publication status and receipt |

These are logical record families, not a requirement for six packages or an exact table count. Keep deterministic policy helpers in core; Convex handlers own transactions; server modules own external calls and read-only tools; UI components own rendering and drafts.

## Where raw source lives

Git and provider records remain the primary artifacts. An authorized read may retain exact immutable bytes in a bounded cache, including Convex File Storage, keyed by repository/snapshot/blob identity and integrity hash. That is not an independently edited second codebase. Do not duplicate every source file into Markdown or let generated prose replace an exact source reference.

Retention roots are active investigations, retained decisions, and approved handoffs. Derived indexes/views can be evicted or rebuilt; human decisions are not expired merely because a display is regenerated. Revocation fences every derivative regardless of pins. If source is no longer accessible or retained, report source_unavailable, never reconstruct a quotation from a summary.

## Completion and honest limitations

A useful first build has real repositories, exact reads, at least literal and structural discovery where supported, durable decisions, live reasoning, and brief export. At least one remote authenticated MCP round trip is a high-priority integration goal. If only local tools work, report that gap prominently. Semantic embeddings, compiler-backed type queries, native MCP Apps rendering, issue POST, and outcome ingestion have separate capabilities and evidence; do not advertise them because folders or labels exist.
