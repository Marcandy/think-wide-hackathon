# Agent-facing tools and the portfolio map

## Decision on Google's OKF

The inspected GoogleCloudPlatform specification calls itself **Open Knowledge Format v0.2**, not a runtime package called 0.2.0. It describes Markdown concepts with YAML metadata, optional directory indexes, and cross-links. It explicitly does not prescribe storage/query infrastructure or replace domain schemas. Its optional computation/attestation material does not execute code or furnish an execution sandbox. [S02]

**Adopt the navigation idea, not a dependency.** Use typed Convex records as the working index, generate bounded index-like views on demand, and optionally export a compatible knowledge bundle later. An OKF export is not required for the hackathon and must not silently become a second authoritative store. Do not call the internal wire format OKF-compliant until an actual export is checked.

Do not turn imported `verified`, `human:` actor labels, or Markdown links into authorization or trusted attestations. Those are source assertions. Think-wide's actual caller identity and evidence verification remain server-derived.

## A virtual tree, not a mounted mega-filesystem

A proposed navigation view:

```text
portfolio/
  repositories/
    project-a/
      overview
      snapshots/<commit>/
        tree/src/...                 metadata and exact source handles
        history                     bounded commit records
      decisions                     authorized durable constraints
    project-b/
      overview
      snapshots/<commit>/tree/...
  investigations/<id>/
    question
    evidence
    alternatives
    decisions
    handoff
```

These are display/navigation concepts, not host paths, HTTP endpoints to expose verbatim, or mandatory physical files. One directory-style operation should list immediate children plus compact metadata. Agents can expand an identified node, traverse relationships, or request exact source without reading the entire tree.

Git already gives us tree objects and blobs. Our new work is the authorized portfolio map and the relationships/decisions that Git alone does not express. Use Git tree enumeration or equivalent provider object APIs; do not ask the model to synthesize a tree. [S03, S04]

## Minimal indexed representation

A repository has a provider identity, display name, connection/grant reference, selected snapshots, and current sync status. A snapshot has repository ID, full commit object ID plus hash algorithm, root tree ID, indexed-at time, and coverage state.

An entry has snapshot ID, parent identity, path identity, kind/mode, blob or tree ID, size if known, language if identified, and parse/index status. Use an index beginning with repository/snapshot and parent for direct children. Add a snapshot+path lookup for exact references. Access scope precedes pagination and ranking; do not retrieve global candidates and leak their names/counts before checking grants. [S09]

For the first small snapshots, materialize bounded entry metadata and extract richer facts only when useful. Cache extraction by blob identity, parser version, and rule version. Reuse unchanged blobs within an authorized cache; map findings back to the exact path/snapshot. Do not globally expose deduplication or cache-hit information across users.

Path identity must not be a normalized display string. Use an opaque source/entry ID that maps to the verified Git entry. If a path cannot be represented safely in the supported UTF-8 profile, explicitly mark it unsupported rather than aliasing it. Reject traversal, NULs, unvalidated symlinks, automatic submodule/LFS retrieval, and arbitrary paths supplied to the server.

Findings carry evidence class, source references, extractor/model identity, observation time, applicability notes, and verification status. A structural match is a finding; a claim that two systems are interchangeable is a hypothesis. A user's rejection is a decision with its own identity and revision.

## Exact source reference

A source reference identifies repository, full snapshot commit, blob, path/entry ID, byte range [start,end), and a digest of the returned exact bytes. History references add the selected commit range. Provider issue/PR/doc references carry provider ID, captured update identity/time, retrieved-at time, and body digest where possible.

Resolve branch names once when selecting a snapshot. Do not retarget a running investigation whenever main moves. On refresh create a new snapshot and mark affected derived conclusions for reconsideration; retain historical evidence as historical.

Exact reads return exact bytes or a labeled encoding, with original range/length and a next-range hint. Human line numbers are an additional presentation. A UTF-8 text read must not silently split/rewrite a character or normalize newlines; either adjust and report the actual range or reject it. No silent ellipses inside an alleged exact quote.

## Tool surface: build a useful subset, keep the contract extensible

Names below are proposed operation IDs, not provider SDK methods. Group related reads with a bounded discriminated mode; do not create a universal execute/query tool. Reads, saved decisions, and external effects remain distinct.

| Operation | Inputs and result | First profile |
|---|---|---|
| `getCapabilities` | Actual enabled modes, limits, contract/catalog versions, auth profile, integration status | Required |
| `listProjects` | Authorized workspace filter and cursor; compact project/snapshot/coverage records | Required |
| `browseSnapshot` | Repo/snapshot/node and cursor; direct children, metadata, exact source handles | Required |
| `readSource` | Authorized source ref, byte/line request and cap; exact evidence with range/hash | Required |
| `searchSources` | Fixed snapshot set, mode, query/rule, filters, budget, cursor; scored or ordered matches with provenance and coverage | Literal and reviewed structural modes required; semantic/type modes conditional |
| `readHistory` | Repo/snapshot, optional verified path, bounded commit count/cursor; commits/diffs with scope | Bounded history required; deep history optional |
| `readGuidance` | Trusted recipe/release ID; concise Skill and relevant rule/reference material | Required |
| `openInvestigation` | Question and authorized snapshot selection; durable investigation/revision | Required |
| `readInvestigation` | ID and detail level/cursor; accepted findings, decisions, revision, run status | Required |
| `recordDecision` | ID, expected revision, typed correction/constraint/rejection and request key | Required |
| `submitProposal` | Investigation/run, base revision, evidence refs, tentative claims/relations and optional catalog composition | Required for host-driven reasoning |
| `requestAnalysis` | ID/revision/driver/purpose/budget; admitted run ID | Backend run only when configured |
| `getRun` / `cancelRun` | Run ID; current authorized status or cancellation fence | Required when runs exist |
| `prepareHandoff` | Current investigation/revision and destination/audience intent; frozen brief revision and hash | Required |
| `readHandoff` | ID/revision and pagination; exact reviewed brief text plus structured references | Required |
| `publishIssue` | Frozen handoff/destination and current human approval binding; receipt or unknown outcome | Optional external effect |
| `refreshOutcome` | Handoff ID and allowed provider commit/PR reference; read-only outcome ingestion | Follow-on |

Connect/disconnect and repository registration have separate owner-controlled UI or operator setup. Do not expose arbitrary installation IDs or local paths as authorization. Do not require every client to understand MCP resources: exact source, guidance, and handoff are available through tools as well. Native UI is an enhancement to an independently useful tool result.

## Context-efficient result envelope

Every discovery response identifies the fixed scope/snapshot set, result kind, entries, coverage, stable next cursor, freshness, and truncation/reason. Include source refs first and short snippets only when useful. Default to compact metadata; detail is explicitly requested.

Initial **proposed application limits**, to implement and measure: 20 search hits per page, 100 direct tree children per page, 16 KiB total tool-result text, and a 16 KiB exact text window. Per-hit snippets and exact windows are limited by the overall serialized response cap, including metadata and any encoding overhead. Reduce the returned window and report its actual range when necessary. Choose smaller values when the host requires it. A request to expand does not bypass authorization or return all the remaining repo.

For bounded analysis initially cap a search job to 2 small demo repositories, 200 selected text files, 20 MiB of scanned source, and 5 seconds of parser/search CPU-wall budget with a kill/reap path. Larger scopes require explicit continuation or a new admitted bounded job, not a hidden unbounded scan. A broader inventory can exist without claiming every file was scanned.

Caps are initial policy, not benchmark results or permanent product limits. Continuation must be stable: cursor is bound to user/grant scope, snapshots, query/rule/options, and ordering. Reauthorize every page. If a stateless search cannot resume safely, retain a bounded result set or return an explicit narrower-scope request; don't fake pagination.

Never infer total matches from a capped page. Mark not-indexed, unsupported-language, parse-failed, byte-limited, time-limited, and excluded content separately. A negative result means nothing found in this completed scope, not proof of global absence.

Convex text search tokenizes content. It must not be relabeled exact code matching. For literal code questions, use a fixed-string or explicitly defined bounded pattern search over the selected immutable bytes. [S10]

## JIT structural analysis

Keep a compact catalog of trusted recipe metadata. Load full guidance only for the selected structural question. A recipe says when to use it, language/parser profile, allowed inputs, matching and nonmatching examples, output interpretation, limits, and when literal/type-aware inspection is necessary. Agent Skills support a progressively loaded instruction/reference structure; actual host-native installation remains a separate integration. [S12]

An agent can select a reviewed rule or propose a declarative rule in a small allowlisted grammar. The latter is still untrusted input: validate its structure and complexity, run bounded rule fixtures, then scan selected immutable bytes. Do not require all useful queries to be prewritten recipes, but no dynamic executable plugins, custom grammar binaries, external config includes, or rewrite fields are admitted.

ast-grep provides structured results and rule-test facilities; record UTF-8 ranges, rule hash, parser/tool version, and scan coverage. Its syntax evidence does not resolve bindings or prove behavior. [S11]

Target-repository Skills, AGENTS files, scanner configs, package scripts, and hooks are content, not authority. Use a trusted tool binary, reviewed arguments, clean environment, no shell interpolation, no rewrite/update flags, and no target-supplied configuration discovery. Native parser processes get no GitHub/model/WorkOS tokens and no writable source mount.

Symbol definitions inferred from syntax are labeled syntactic. Binding/type queries need a verified compiler index with compiler/options/dependency provenance; never quietly install a target project to obtain one. Importing specialist-generated index/CI results later is permitted if provenance is retained. Tests run by a specialist or CI are reported evidence, not tests Think-wide claims to have run.

## Worked agent walk

Ask which projects contain durable command handling. List project metadata. Narrow to two snapshots. Inspect their manifests and directories. Run literal search and then a matching structural recipe. Read the exact candidate spans. Compare retry/cancellation assumptions, stating unknowns. Record the user's "contract only; no persistent worker" correction. Re-query relevant sources and submit a revised hypothesis. Prepare a brief with evidence links, constraints, rejected choices, likely files, and acceptance conditions.

A new agent resumes from the investigation ID and selectively expands the same exact evidence. It receives current state and references, not the old conversation transcript or every repository file.
