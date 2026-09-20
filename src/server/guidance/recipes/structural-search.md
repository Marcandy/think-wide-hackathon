---
recipeId: recipe.search.structural
title: Bounded structural search with reviewed rules
appliesTo: searchSources (mode structural)
---

## When to use this

You want syntax, not text: *exported function declarations*, *direct `eval` calls*,
*calls to this API*. Structural search parses the file and matches the shape, so a
comment, a string literal or a similarly named symbol does not match.

Request a rule by `ruleId`. You cannot send rule text: the rules are reviewed and live
in `src/server/search/rules/`, each with a matching and a non-matching fixture.

## What a match means

A match is **`observed_structural` evidence that this syntax exists at this byte
range**. That is all. It is not a judgement that the code is reachable, exploitable or
equivalent to something in another repository. A claim that two systems are
interchangeable is a hypothesis for a human to accept or reject, and it is recorded as
such.

Every finding records the analyzer version and the sha256 of the exact rule text that
produced it. A rule edit changes the hash, so old findings stay attributable to the
rule that actually ran.

## Limits and confinement

The analyzer is a subprocess that receives only the bytes of the selected snapshot
entries, in a directory created for the request, with an environment built from nothing
(`PATH`, `HOME`, `LANG`). It never gets application, provider or SSH credentials, never
loads configuration from the scanned tree, is never invoked through a shell, and is
never passed a rewrite, update or interactive flag. It is killed at the wall-clock
budget and its directory is removed afterwards. This product reads source; it does not
build, execute or modify it.

## Coverage you must read before concluding anything

| Field | Meaning |
|---|---|
| `parseFailed` | The file did not parse. **Not** "no match". |
| `unsupportedLanguage` | No rule for this language. **Not assessed**, not clean. |
| `excluded` | Symlink, submodule or binary. Never followed. |
| `notIndexed` / `byteLimited` / `timeLimited` | Files the scan never opened. |
| `status: "not_indexed"` with zero entries | The analyzer was unavailable. Structural capability is **missing**, and `getCapabilities` says so. |

An empty result set with `status: "partial"` answers "nothing found in what was
scanned", never "this pattern does not occur in the repository".
