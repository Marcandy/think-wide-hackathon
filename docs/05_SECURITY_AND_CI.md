# Security, tests, and CI that fit the build

## Non-negotiable boundary decisions

**Privacy:** private by default; explicit shared grants; no automatic admin read of private content. Upstream public source does not make a user's private question/decision public. Service operators retain powerful host/database access; this is not end-to-end encryption against them.

**Identity:** WorkOS login establishes the product principal, not GitHub installation rights. Deliberately configure the MCP resource/audience, trusted issuer/JWKS, and each browser/CLI/MCP flow. The gateway and private Convex backend must validate their intended profile; do not omit audience checking, turn on test auth publicly, or substitute an admin key to rescue integration. [S08, S22]

**Authorization:** operation permission AND every referenced object's grants. Include project metadata, counts, pagination, cached snippets, findings, decisions, status, cancellation, and actual file bytes. Grant IDs/cursors/paths are addresses, not permission.

**Audience:** a brief for repo A may include repo B's private evidence. Issue destination visibility and actual readers must be compatible with all consumed sources and private decisions. When that cannot be established, export privately or draft a deliberately redacted version and review it. Same organization is not proof of same readers. Public issue creation remains disabled for private-derived output without a separate explicit authorized publication decision.

**Issue effects:** separate prepare, human-confirm, publish, and receipt. Approval binds destination repo, frozen title/body hash, handoff revision, principal, current source grants, authorization epoch, and expiry. A changed body needs renewed approval. Agent `approved:true` never suffices. Creating an issue can notify people and disclose information; it is not a harmless read. The provider endpoint supports issue creation, but application exactly-once semantics are ours to establish. [S26]

Use a transactional effect reservation and a deterministic marker in the issue body. After an ambiguous response, mark outcome unknown and reconcile by authoritative receipt/observed provider object; no blind retry. A search that has not yet indexed the marker is not proof the first issue was never created.

## Revocation and modes

Current-session logout closes that session and fences its interactive runs under the chosen session policy. Global sign-out, resource revocation, and GitHub disconnection are different actions; test each implemented scope. Recheck grants before source reads, result publication, issue POST, and stream emissions/reconnects. Clear user-scoped UI caches on account change.

Mirror authoritative membership/revocation changes and use a short bounded freshness policy; the initial target is no more than 60 seconds for upstream changes, with fresh checks for consequential issue publication. This is a target to measure, not a guarantee that JWT expiration or webhooks alone provide instant revocation. Fail closed when a required fresh check cannot be obtained. Already delivered copies in hosts, browsers, exports, or GitHub cannot be recalled by deleting a Convex record.

### Isolated fallback is not weakened production

Two configurations must be visibly different:

- **Connected mode:** real token verification, current source grants, tested remote HTTP/MCP, protected byte delivery, bounded external provider calls.
- **Local demonstration mode:** loopback-only owned web or a locally launched stdio client, operator-selected public/synthetic data, fixed local authority derived from the trusted process, no internet/LAN tunnel, no remote issue publishing, no claims of multiuser hosted verification. Real-handler A/B tests use isolated fixtures, not arbitrary public identity headers.

A fixture-auth bypass must not exist in a publicly served path. Production startup should refuse local-demo settings. A remote browser-based MCP client cannot connect to an unexposed local process; this fallback does not complete the external-host requirement. [S24]

## Git connector and analysis controls

Prefer a selected-repository GitHub App. Read-only contents/metadata for source access; request Issues write only for the optional issue publisher. No contents-write or Actions permissions for this profile. Installation tokens can be repository/permission scoped and short-lived; keep provider credentials at the trusted broker. Verify the acting user's entitlement to that installation/repo separately. [S25]

The bounded native analyzer gets only selected immutable source, approved rule definitions, time/memory/output limits, and no application/provider/SSH credentials. No Docker socket, host home, SSH agent, repo hooks/config includes, arbitrary remote URLs, or shell interpolation. Treat third-party issue bodies and source files as untrusted data. A denied model proposal and a model refusing injection are different test observations.

## Andrew's first work does not wait for hosted auth

Start with A/B fixture identities, independent permission expectations, synthetic source markers, and observable database/job/provider effects. Test actual handlers. Do not mock authorization to return deny. Use the supplied readiness notes as workstation context, not as application evidence: they report 28 local checks, but hosted integration and deployment were explicitly NOT RUN. [F01, F02 in 08_SOURCES.md]

## Acceptance suite to implement during the event

All cases below begin NOT RUN. Tests use owned, disposable environments. Negative tests never target WorkOS, model providers, venue networks, or unrelated GitHub organizations.

| ID | Test specification | Evidence required |
|---|---|---|
| Q01 | A reads A, B reads B, B substitutes A's source/investigation ID | Allowed controls, denied bytes, unchanged business state and no unauthorized job/provider dispatch |
| Q02 | Missing/expired/wrong-issuer and validly signed wrong-audience tokens | Independent verifier cases plus real accepted login when available |
| Q03 | Nested references, tree counts, cursor replay, changed query/snapshot, revoked cached result | No foreign metadata; cursor conflict/denial; current scope honored |
| Q04 | Exact byte window, Unicode/newlines, stale branch, missing blob, symlink/path injection | Matching hashes/ranges or explicit unsupported/unavailable response |
| Q05 | Literal and structural fixtures, misleading same-name syntax, parse failure, scan caps | Positive/negative matches, evidence-class label, exact refs, complete coverage status |
| Q06 | Late proposal at N after human correction at N+1 | Human decision retained, obsolete publication rejected, reopened view correct |
| Q07 | Duplicate command then same key with changed arguments | One admitted business transition, explicit conflict for changed payload |
| Q08 | Wrong/unknown catalog component/action, oversize/deep composition, inert script-like text | No unsafe render/fetch/effect, preserved input and useful fallback display |
| Q09 | Logout/revoke/disconnect during stream and queued work | Measured future-read/emission/dispatch fencing; no claimed recall of delivered copies |
| Q10 | Source/issue text requests other-user data or raw shell | Direct forbidden tool attempt denied even if model would comply; normal read still works |
| Q11 | Export containing mixed-private evidence to wider issue audience | Audience denial/redaction workflow; no publication until a permitted frozen brief is approved |
| Q12 | Approved issue then replay/change/timeout after dispatch | Binding checks, one effect or explicit unknown, provider-side observation not just UI status |
| Q13 | Native analyzer tries forbidden file/network/write in controlled harness | No secret/operator access; time/output limit and cleanup behavior; source remains unchanged |
| Q14 | Gateway, direct Convex handlers, MCP, CLI, framework routes expose same operation | Same policy and validation; inventory includes routes outside OpenAPI |
| Q15 | Two public/synthetic Git repos → live question → correction → changed result → reopen → brief | End-to-end recorded commit/config, actual source refs, real reasoning driver |
| Q16 | Chosen remote host performs login, tree, search, exact read, decision and brief calls | Host/build/protocol identity, actual results, disconnect/reconnect behavior; UI rendering separately marked |
| Q17 | Actual deployment listeners, restart, admin/file access, local-demo refusal | Public HTTPS only, private Convex/dashboard, restricted SSH, persistent data, configuration evidence |
| Q18 | Clean install/build/codegen twice, hidden transitive dependency, secret scan, stale evidence | Reproducible artifacts, actual checks/coverage, no imaginary lockfile or fabricated pass |

Unit tests, mocks, real self-hosted integration, live provider/host checks, and actual deployment are separate rows in the evidence matrix. A required unrun case blocks that capability. N/A needs an explicit removed feature, not an unavailable credential.

## CI and frequent integration

Use the same checked-in verification entry point locally and on CI. Eassa wires Blacksmith if authorized; another available runner is an explicit temporary substitute. Use a clean/frozen install, codegen diff, typecheck, small deterministic tests, real-handler Convex tests, then browser and one live smoke when credentials are appropriately isolated. Do not make all optional scanners prerequisites for the first useful commit. [S16]

Pin reviewed actions by full commit SHA, keep token permissions minimal, and don't combine untrusted PR code with deploy/provider secrets. Avoid privileged pull_request_target execution of submitted code. Cache keys include OS/runtime/lock identity; untrusted caches must not feed a privileged promotion path. [S17]

The application build can test its own code in CI; it must not install or run ingested source projects as part of a product request. Test local fixtures and independent expectations. Review scanners for actual language/lock coverage: unsupported files are NOT ASSESSED, not clean.

Use short task branches and coherent commits. One writer per area/worktree. A commit includes task ID, behavior, validation evidence, limitations, and next handoff. Required checks and appropriate review protect main. Ordinary changes need not all queue behind Eassa, but auth/contract/workflow/deploy changes receive their designated reviewer.

Promote the tested commit/image by immutable identity. No runtime git pull, mutable latest tags, or production dependency installation. Document actual public ports, Docker publishing, IPv4/IPv6, volume permissions, and SSH recovery before claiming deployment. If a restore is claimed, test it on a disposable instance and reapply revocations before reopening; otherwise mark it NOT RUN.

## Minimal evidence receipt

Record task/case, tester, commit/config/image when applicable, layer (unit/local/live/deployed), expected and observed effects, actual command, status, sanitized artifact location, and next action. Preserve the unmodified first demo recording. Keep source text, tokens, cookies, sensitive query strings, and raw trace dumps out of public issues and the public repository.
