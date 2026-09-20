# T05 first slice: local Git snapshot reader

September 20, 2026. Branch `feat/t05-git-snapshots`, base `41e73ad` (main after PR #12). Issued task: [#11](https://github.com/freebatteryfactory/think-wide-hackathon/issues/11). Marc explicitly requested starting T05 while T03 awaits merge; this does not claim the original 13:30 checkpoint was met.

Status: **IN PROGRESS**, not PR-ready. Evidence level: **local real Git adapter over synthetic repositories**. No Convex source operation, provider connection, or deployed behavior is claimed.

## Implemented and exercised

- Imports operator-selected, self-contained Git bundles into private temporary bare stores; no target working tree, config, hook, filter, submodule, LFS download, or source program is executed. The public request shapes never accept a filesystem path.
- Pins the advertised ref once to the full commit and root tree. Opaque entry IDs bind snapshot and exact display path; source lookup uses the verified tree entry's blob ID.
- Bounded metadata traversal, immediate-child pages, signed cursors scoped to snapshot and parent, 100-child maximum plus the shared 16 KiB serialized response cap. Pages do not invent global counts from their lengths.
- Exact byte/line windows with SHA-256 over returned bytes; checks Git blob identity as well. Preserves CRLF, Unicode and BOMs. Split UTF-8 windows reject with `invalid_request`, an allowed alternative in issue #11; they never produce replacement characters.
- Missing/closed stores return `source_unavailable`; symlinks, submodules and LFS retrieval are unsupported. Oversized blobs retain `too_large` metadata. Files remain `not_indexed` until a search analyzer indexes them; no fabricated parse status.
- Git runs with an explicit clean environment, no shell, bounded stdout/stderr and a five-second process-group deadline. The group is killed before waiting for close, covering Git's index-pack helper as well as its parent.

Actual fixture commits: alpha `b2fccd63dfa868448ab1f5c38bc6cda11139dcec`, beta `28c8c4e1d38565109b1f9853c678b50351dc2705`. `/usr/bin/git --version`: `git version 2.54.0 (Apple Git-157)`.

## Verification and adversarial review

`bun run verify` exited 0: frozen install unchanged, no generated contract drift, Biome, TypeScript, **185 tests across 11 files**, production build. Log: `/tmp/think-wide-t05-reader-verify.log`. T03 tests are on its separate branch and are not included in this total.

Extended Q04 tests call the real reader against Andrew's bundles. Additional generated synthetic repositories exercise multi-page traversal, scoped cursor rejection, inherited Git configuration/object-path isolation, missing input bundles after import, BOM identity, raw and serialized byte caps, oversized/binary/LFS content, invalid operator selections and subprocess output limits.

Own adversarial review checked argument injection, environment/config inheritance, source-path versus opaque-ID lookup, symlink following, object integrity, UTF-8 replacement, range inversion, foreign snapshots, cursor scopes, stale source handling, excluded-parent reachability, memory/output limits and cleanup. Fixed during review: preserved filename BOMs, removed unreachable descendants after parent exclusion, killed helper process groups on cancellation, opened bundle files without following symlinks or blocking on FIFOs, and enforced the response cap in addition to the raw window cap. The final code passed verification after these fixes.

CodeRabbit has **not run for T05**. Per Marc's updated rule, it runs at PR readiness; this intermediate checkpoint is not ticket completion.

## Remaining T05 work

1. Bounded history with the canonical commit-record schema, generated outputs and Eassa's contract review (#10 coordination).
2. Convex repository/snapshot/entry registration and exact-byte cache; create the registering principal's snapshot grant atomically. No public local fixture principal.
3. Extend T06's operation/authorization boundary for `listProjects`, `browseSnapshot`, `readSource`, `readHistory`; authorize before pagination/read and recheck every nested source. Existing snapshot membership alone is not proof that a ref exists.
4. Durable cursor/cache behavior and real authorized handler tests: positive controls, foreign/missing indistinguishability, revoked grants, cache corruption/eviction, entry/ref verification.
5. End-of-ticket adversarial and CodeRabbit review, full verification, then a separate T05 PR reviewed by Andrew.

Current adapter limits: bundle 32 MiB, tree-command output 1 MiB / 5000 entries, blob read 1 MiB, exact window and serialized result each at most 16 KiB. A text window that would exceed the serialized cap rejects and asks for smaller `maxBytes`; it does not truncate silently. Cursors live for the imported snapshot instance. Stores are temporary and explicitly closed, not a substitute for Convex state. Runtime currently targets macOS/Linux with `/usr/bin/git`; Windows is unverified. No dependencies, generated files, shared instructions or canonical contracts were changed.

Git behavior references: [bundle verification and unbundling](https://git-scm.com/docs/git-bundle), [raw object reads via cat-file](https://git-scm.com/docs/git-cat-file).
