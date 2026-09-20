# 0002: One operation pipeline, inside the Convex transaction

Date: 2026-09-20 · Owner: Eassa · Reviewer: Andrew · Status: accepted · Implemented by T06

## The three facts that decide it
1. A Convex mutation is one atomic transaction. It is the only place where a check and the write it guards happen with no gap.
2. Several doors lead to the same data: HTTP, MCP, any CLI, and a Convex client wired into the browser. Policy in the Node gateway can be walked around; policy in the Convex functions cannot.
3. The product promise is that a human decision outlives stale machine work. Any mechanism that can lose or overwrite a decision breaks the product.

## Decision
Every public Convex function is registered through one wrapper, `convex/lib/operation.ts`, keyed by `operationId` from `generated/operations.ts`. In this order, inside the same transaction:

1. validate the single `request` argument with the generated validator
2. derive the principal from `ctx.auth` only
3. for state-changing operations, reserve or replay the receipt
4. call the handler with an already authorized context
5. validate the response with the generated validator, including `kind === envelopeKind`, then each envelope entry with the operation's registered entry validator (`entriesType`)
6. finalize the receipt

Handlers never touch protected tables through raw `ctx.db`. They use `loadAuthorized(kind, id)` / `queryAuthorized(...)` from `convex/lib/authz.ts`, which return the document or throw `not_found`.

## The five responsibilities
| # | Rule | Why the alternatives lose | Bucket |
|---|---|---|---|
| 1 Identity | Only from `ctx.auth`. Request schemas forbid identity fields. | "Pass the user in the request for now" is a bypass that outlives "for now". | Structural |
| 2 Grants | One accessor. Ownership is a grant row written in the mutation that creates the object; no separate owner field grants access. Missing and forbidden share one code path and one error. | Two access mechanisms are two places to revoke. | Runtime policy at one point, plus a test that fails on raw `ctx.db` access to protected tables outside `convex/lib/` |
| 3 Decisions | Optimistic concurrency: compare `expectedRevision` in the mutation. Decisions are append-only rows; revision is a counter. | Last-write-wins loses human decisions. Locks need leases. Event sourcing is unearned complexity. | Runtime policy |
| 4 Receipts | Key = principal + operationId + requestKey. Store the argument digest and result IDS, never bodies. Replays re-read through the accessor. | Storing bodies creates "replay after revocation leaks private data" and a special case to patch it. | Emitted evidence that also enforces |
| 5 Run fencing | Capture base revision + grant epochs at admission as a fencing token; the publication mutation compares it. | "Cancel the job when the human decides" cannot stop an action already in flight. Cancel is a courtesy; the fence is the guarantee. | Runtime policy + evidence (`superseded`) |

## Still a judgment call
- Grant granularity: per snapshot today, because that is the narrowest level the demo needs. Widen only when real use forces it.
- Whether the browser talks to Convex directly or only through the Node app: a deployment choice for I04. T06 is identical either way, which is the point of putting policy at the data layer.
- How the running `local-demo` app obtains an identity (tests use convex-test identities): not T06. Expected answer is a local dev JWT issuer the self-hosted Convex trusts, scoped under I01 or T08.

## Acceptance it must satisfy
Q01, Q03, Q06, Q07, Q14 in 05_SECURITY_AND_CI.md. An adversarial QA round follows implementation.
