# T05 review: Git snapshots and protected source operations

September 20, 2026. Branch `feat/t05-git-snapshots`, rebased onto main with T03
PR #13 merged. Task: [#11](https://github.com/freebatteryfactory/think-wide-hackathon/issues/11).
Status: **REVIEW**. Evidence level: **local real handlers over synthetic Git repositories**.
This does not claim the original 13:30 checkpoint was met or a hosted deployment.

## Acceptance

| Requirement | Result |
| --- | --- |
| Two actual commit/tree identities | DONE: alpha/beta bundle imports, pinned full commit/root tree |
| Immediate children and stable bounded pages | DONE: local HMAC cursor and persistent authorized Convex cursor |
| Exact bytes/digests, Unicode, CRLF, BOM, inverted ranges | DONE: shared window logic, Git object identity and SHA-256 verification |
| Missing/evicted/corrupt source and truthful coverage | DONE: explicit errors; no reconstructed quotes or invented totals |
| Source refs reach the shared domain boundary | DONE: indexed entry existence, repository/commit/blob/size checks before decisions |
| Bounded history and canonical entry schema | DONE: first-parent log/diff, generated CommitRecord, authorized cache pages |
| Search receives real source identities | DONE: GitSnapshot.scanEntry; real literal hit reproduces readSource digest |
| Public source operations use the T06 pipeline | DONE: listProjects, browseSnapshot, readSource, readHistory |
| Local verification | DONE: command/result below |
| Integration into main | NOT DONE: requires PR review/merge |

## Behavior and bounds

Operator-selected self-contained bundles import into private temporary bare Git stores.
No public request accepts a host path. Git uses a clean environment, fixed argument
arrays, no shell, hooks, target config, filters, LFS/submodule fetching, or target code
execution. Each process has output limits and a five-second process-group deadline.
History shares one five-second budget across all commands in a page.

Bundle limit: 32 MiB. Tree output: 1 MiB / 5000 entries. Local blob: 1 MiB.
Convex registration: 750000 bytes; cache blob: 512 KiB. Reads and serialized responses:
16 KiB. Tree pages: at most 100 entries. Project pages: at most eight authorized
snapshots, grouped by repository within each page; consumers can merge repository
identities across pages. Revoked grants can produce empty pages with a continuation.

History returns at most 20 commits/page and traverses at most 1000 commits in one
local snapshot's cursor chain. Each record has at most 16 parents, 100 changed paths,
a 512-character subject, and bounded raw commit/diff output. Over-limit records reject;
commit metadata is not silently shortened. Diffs compare the first parent (empty tree
for roots). Entry filters do not follow renames; changedPaths still describes the whole
commit. The Convex cache holds at most 100 records / 750000 bytes per snapshot/filter.
An incomplete cached prefix ends with partial coverage and no continuation beyond
cached data. Replacing cached records invalidates its previous cursors.

Internal registration writes metadata, entries and the verified registering principal's
owner grant atomically. Internal cache writes also require current ownership. Public
reads authorize before pagination, use principal/snapshot/filter-bound cursors, and
recheck grants on every call. Exact reads verify Git blob identity and cache integrity
before computing the returned window digest. Stored decision refs are checked against
the index; this does not promote findings to bytes_verified without reading bytes.

Actual commits: alpha `b2fccd63dfa868448ab1f5c38bc6cda11139dcec`, beta
`28c8c4e1d38565109b1f9853c678b50351dc2705`. `/usr/bin/git --version`:
`git version 2.54.0 (Apple Git-157)`.

## Verification and adversarial review

`bun run verify` exited **0**: frozen install unchanged, contract drift clean, Biome,
TypeScript, **309 passed / 25 skipped across 19 test files**, production build.
Log: `/tmp/think-wide-t05-final-verify.log`. The 25 skipped cases are existing structural
analyzer/confinement tests: the sandboxed host did not expose a usable isolation profile.
They are not claimed as passing. Build emitted dependency `use client` warnings;
Biome reported two existing test-file informational diagnostics.

T05 exercises real Git commands and registered Convex handlers, including atomic
registration/rollback, anonymous/foreign/reader access, revoked grants between pages,
cache corruption/eviction, scoped cursor replay, actual root/parent diffs, fabricated
refs, and actual search-to-read identity/digest reproduction. Q04 tests cover original
fixture bytes, Unicode/CRLF, and missing/unsupported source. T06's 50 existing handler
tests pass with indexed snapshot fixtures.

Own adversarial review checked command/path injection, subprocess bounds, object
integrity, UTF-8 boundaries, current authorization, nested reference validation,
registration immutability, cursor scopes and invalidation, cache corruption, response
caps, history completeness, and regressions to durable decisions. Fixed the search
adapter's hardcoded SHA-256 label: SHA-1 Git refs now retain their real algorithm in
literal and structural findings. The full test gate passed after those fixes.

Contract output was regenerated with `bun run codegen`. Convex CLI's
`bunx convex codegen --dry-run --typecheck disable` completed; ordinary codegen's upload
step was blocked by automatic approval review. API bindings were generated locally
with the installed Convex `apiCodegen` template and Prettier, without a deployment or
handwritten API interfaces. The project currently uses no Convex components.

Marc's latest instruction: **no local CodeRabbit run**; leave CodeRabbit to PR checks.
No CodeRabbit pass is claimed. Reviewers: Andrew for source behavior; Eassa for the
CommitRecord contract and authorization/schema integration.

## Downstream integration and limits

T03 is merged and is no longer a blocker. T05's tested local implementation is ready
for review. T08 must connect its authenticated transport/ingestion path to the internal
registration/cache functions; T09 must connect workbench UI to these operations.
These handlers have not been deployed or exercised through a live provider/browser.
No fixture principal, public upload endpoint, or auth bypass was added.

An operator ingestion path calls `openSnapshot`, registers its generated Project and
entries through `internal.snapshots.register`, writes exact blobs using
`internal.sourceCache.put`, and caches observed history using
`internal.snapshots.putHistory`. Those internal calls must preserve verified auth;
an administrative credential alone is not a registering user's identity. Missing
cached bytes/history remain source_unavailable. Stores are temporary and explicitly
closed. macOS/Linux `/usr/bin/git` is supported; Windows is unverified.
