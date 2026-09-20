---
recipeId: recipe.search.literal
title: Fixed-string search across two snapshots
appliesTo: searchSources (mode literal)
---

## When to use this

You know the exact text: an identifier, an error string, an environment variable name,
a header. Literal search matches those bytes and nothing else.

Use it **before** structural search when you are still looking for where something is
mentioned at all, including in comments, configuration and prose.

## What it does not do

- It is not a regular expression. `.*` matches the characters `.*`.
- It is not a text index. There is no stemming, tokenizing or ranking; there is no
  "relevance" order. Results come back in snapshot entry order.
- Case-insensitive matching is ASCII-only. A non-ASCII query with `caseSensitive:false`
  is rejected rather than quietly under-matching.
- A hit in a comment or a string literal is a hit. If you need "declared here", not
  "mentioned here", use structural search.

## Limits you will hit

2 snapshots, 200 files, 20 MiB scanned, 5 s wall clock, 20 hits per page, 16 KiB of
result text. Each has its own report:

| What you see | What it means |
|---|---|
| `truncated.reason: "page_limit"` | More hits exist in this scan. Follow `nextCursor`. |
| `coverage.byteLimited` | Files were left unopened. The answer is incomplete. |
| `coverage.timeLimited` | The clock ran out mid-scan. The answer is incomplete. |
| `coverage.excluded` | Symlinks, submodules and binary blobs. Never followed or parsed. |
| `coverage.status: "partial"` | Something was not looked at. Do not read zero hits as absence. |

**Never infer a total from a page.** Twenty hits and a cursor means "at least twenty".

## How to read a result

Every finding carries one `SourceRef`: repository, full commit, blob, entry id, a
half-open `[start, end)` byte range and the sha256 of exactly those bytes. Re-read the
range through `readSource` and the digest must reproduce. If it does not, the snapshot
you are quoting is not the snapshot that was searched — treat the finding as stale, not
as a disagreement to average out.

`displayPath` is for humans. It is never used for lookup or authorization.
