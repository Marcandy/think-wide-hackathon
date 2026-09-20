# Contract, Convex, and generated UI

## Canonical inputs and generated outputs

Author public operations and JSON schemas during the event. Use the previously selected OpenAPI 3.1 tooling profile unless actual installed tools require a reviewed adjustment. Keep schemas local and explicit. Public contract and internal persistence schema serve different purposes; one does not need to expose every field of the other. [S20]

Generate TS public types, Ajv standalone validators, and straightforward operation descriptors/tool schema bindings. Prefer maintained generators and a small explicit operation registry to an elaborate first-party compiler. The same canonical validator governs HTTP, MCP, and domain boundary payloads. The registry identifies handler, exposure, effect class, approval requirement, and projection. New operations are not agent-exposed automatically. [S21]

Generate schema-library bindings only if required by the actual installed renderer/SDK; support a documented subset and fail on unsupported constructs. Do not independently hand-maintain the same nested contract in JSON Schema, Zod, TS, MCP, and UI. Generated TS types do not validate runtime input, and a renderer's reduced schema helper is not necessarily an equivalent validator.

Build checks must catch omitted handler/renderer bindings, unknown tagged actions, mismatched operation IDs, unsupported schema constraints, and output drift. Generate into a clean directory twice and compare; inspect untracked files as well. No model call belongs in this deterministic generation pipeline. Generated expected-output fixtures supplement, not replace, independently authored adversarial cases.

## Handwritten semantic core

Keep only the rules requiring judgment in code: trusted principal/grant derivation, object authorization, exact-source identity, command/revision semantics, decision preservation, run/publication admission, downstream audience checks, and effect reconciliation. Do not abstract every function into a new layer.

Domain checks use verified identity, not request owner/role fields. Validate all referenced objects, not just the outer investigation. A generated view conservatively depends on every private input consumed by the run; it cannot launder a private source by omitting a citation.

A command receipt binds actor, operation, resource, request key, and canonical argument digest. Same key/same payload returns current authorized result identifiers. Same key/changed arguments conflicts. Receipt replay cannot return a cached private body after revocation.

## Proper Convex responsibilities

| Function kind | Think-wide responsibility | Not allowed |
|---|---|---|
| Query | Authorized project/tree/investigation/decision/status projections, indexed scope lookup | External network calls, model inference, hidden writes |
| Mutation | Validate/authorize, compare revision, preserve decision, reserve run/effect, update lifecycle, record receipt, atomically schedule | Provider calls, target repo execution, partial out-of-transaction state |
| Internal action | Bounded provider/model work for an admitted job; load current state through internal queries; finalize through mutation | Direct ctx.db use, assuming scheduler retained user identity, unbounded retries |
| Internal publication mutation | Check current run/epoch/revision and input grants, validate proposal, publish accepted projection | Trusting model success claims or stale approval |
| Server read-only analyzer | Native Git/text/AST inspection of selected immutable bytes, with current caller/job scope | Arbitrary target scripts or broad provider credentials in the parser |

Convex actions access database state through queries/mutations; scheduling from a mutation is atomic with that mutation. Scheduled authentication is not inherited, and cancellation does not undo an external effect already dispatched. Verify exact runtime behavior on the chosen self-hosted backend. [S05, S06]

Pass opaque job IDs to scheduled work, not secrets or full source/prompt payloads. Load job owner, permitted source set, approved budget, current grant epoch, and expected revision from trusted records. Service calls use their own deliberately scoped identity, never a deploy admin key or caller-supplied actor string. Internal function names alone are not a security boundary if exposed callers can invoke them indiscriminately.

Keep queries/mutations outside files marked for Node-only actions. Native Git/ast-grep belongs in the application analyzer, not a guessed browser or Convex-query API. Source results can be retained as exact bytes for later admitted model actions; the app controls the cache and its access. Avoid a cross-service callback mechanism unless actual analysis needs it.

## Reasoning state transition

Admit a run against investigation revision N and source/grant epochs. The host driver submits its proposal, or one backend action calls the selected provider. Human correction creates N+1 immediately, without a model. Any result for N is superseded unless explicitly re-evaluated under N+1. Store the correction separately from the generated display.

An accepted proposal means its shape, references, and authority were validated, not that its reasoning is mathematically proven. Keep hypotheses marked as such. Tests and actual source observations retain their own evidence classes.

A provider timeout after dispatch is external_outcome_unknown. Reconcile if possible; do not automatically submit another costly or state-changing request. A malformed completed model response can be rejected with a useful error or one admitted bounded correction attempt, never an infinite repair loop.

## Theme and semantic catalog

Marc chooses a tweakcn theme with Eassa, reviews the exported light/dark tokens, and commits them to one theme file. Keep mappings/globals separate so changing tokens does not overwrite behavior. shadcn's semantic variables give the component styling boundary; the chosen export still needs keyboard, contrast, focus, and small-screen checks. [S13]

Use TanStack Start/Router for the shell and TanStack Form for explicit human input. If Start integration fails its early probe, a documented React/Router shell can be the cut without changing the domain contract. Do not add Query/DB/Store as parallel owners of Convex state. Extra TanStack packages must remove actual work. [S14]

First catalog: EvidencePair, ConnectionCard, ConstraintEditor, HandoffPreview, with bounded Stack/Section composition. Portfolio filters, source identity, auth indicators, and approval controls remain stable shell features. Model output references source/evidence IDs, not executable JSX, arbitrary CSS, new event handlers, unbounded URLs, or hidden tool authority.

CopilotKit/A2UI can connect an authored catalog to owned React renderers. Pin the actually compatible renderer/wire profile; documentation snippets from differing versions are not interchangeable. AG-UI is an event/interaction adapter, not another database. MCP Apps provides an embedded-host shell; it is not proof that an arbitrary host can render this catalog. [S15, S23, S24]

Validating a composition must check allowed components, closed props, references, revision, total size/depth, and action bindings. Initially bound to 16 nodes, depth 4, and 32 KiB serialized composition; limit further if required. Preserve source display and drafts if rejected. Basic navigation, expanding evidence, saving a constraint, and exporting an already prepared brief do not need an LLM round trip.

## Contract freezing without paralysis

Freeze the first handoff shape before parallel implementation, not every future feature. Each additive schema change has a short ticket/comment, owner, compatibility note, generator update, and affected tests. Coordinated shared changes are faster than three local interface variants. Do not add a general schema migration engine to solve one day's coordination.

## Application file shape, created during the event

```text
think-wide-hackathon/
  contracts/       public schemas, exposure/effect metadata
  generated/       public types and validators
  core/            policy, revisions, evidence and handoff semantics
  convex/          schema, queries, mutations, actions, _generated
  src/server/      auth, MCP/HTTP, providers, bounded analyzer
  src/components/  semantic catalog and shadcn primitives
  src/routes/      owned workbench and required callbacks
  src/styles/      reviewed theme and mappings
  tests/           fixtures, domain, adapter, browser, boundary checks
  scripts/         small build/codegen/check commands only
  infra/           reviewed local/deploy configuration
  docs/            current short contracts, decisions, sanitized evidence
  .github/         minimal CI and ownership controls
```

This box contains none of those application files. Generate and implement them only in the authorized build checkout, with actual installed APIs.
