# T03 local implementation and review receipt

Date: September 20, 2026. Branch: `feat/t03-workshop`. Base: `4a270f42cf7183fad9ee0a9c485cf0b88830f51a` (PR #8, including PR #6). This receipt describes the T03 PR implementation against that base. Acceptance and merge remain with the reviewer.

Status level: **fixtures only**. Contract migration is complete. Browser acceptance and Andrew's review remain pending. The original 12:30 checkpoint was missed; Marc explicitly authorized continuing. This receipt does not claim that deadline was met.

## Implemented

- `/workshop` and its home-page link; supplied tweakcn light/dark tokens in `src/styles/theme.css`, separate mappings and layout styles; shadcn primitives and TanStack Form.
- The decision selector includes all four original contract actions, including Acceptance. Its kind type comes from generated `RecordDecisionRequest`, with an exhaustive UI label map. Acceptance is a local preview and does not change a finding status. No category field is added.
- All six catalog components: EvidencePair, ConnectionCard, ConstraintEditor, HandoffPreview, Stack, Section.
- Public contract 0.1.0: nested composition using generated `Composition`, `CatalogNode`, and `SourceRef` types and the generated Ajv `Composition` validator. The old flat-node Zod schema is removed. Generated files and canonical contracts are unchanged.
- Supplemental local checks: 32 KiB UTF-8; at most 16 nodes/depth 4 **before** invoking recursive schema validation; supported catalog version; exact source identities; current investigation and handoff revisions; known finding status; one decision editor per view. These local fixture checks are not server authorization.
- Contract-owned fields remain closed. No model-supplied HTML, CSS, URLs, handlers, or action names. Callbacks are fixed by the renderer. The contract has no Stack direction field, so composition stacks use vertical layout.
- Source display metadata comes from trusted fixture data. Fixture blobs and SHA-256 digests match displayed excerpts; commits/repositories are explicitly invented, not verified Git observations.
- Clearly synthetic comparison/unavailable/empty states, session-only decision preview, rejected-layout fallback, and Markdown download. Drafts survive view replacement; reload clears them. No live provider or durable persistence claim.
- Legible TypeScript, Biome formatting, braces enforced in `src/**`. Vitest preserves T02/T04 configuration and includes `.tsx` render tests.

## Integration and recovery

`main` and the feature branch were fast-forwarded to PR #8. `main` tracks team `upstream/main`; `origin` remains Marc's fork. Recovery stashes preserve pre-sync work. The Vitest merge conflict was resolved retaining upstream aliases, isolation, exclusions and timeouts plus TSX discovery. Eassa's `AGENTS.md` was pulled unchanged; personal instructions remain in `Marc-ticket-notes.md`.

## Verification

- First migrated `bun run verify`: passed frozen install, contract drift (none), Biome, TypeScript, 160 tests across 11 files, production build. Log: `/tmp/think-wide-t03-contract-verify.log`.
- Subsequent `bun run test`: 162 tests passed after adding checks that fixture byte ranges/digests are exact and incoming display labels cannot replace trusted source metadata.
- Final `bun run verify` passed after review fixes: frozen install unchanged, no contract drift, Biome (61 files), TypeScript, 162 tests in 11 files, production build. Log: `/tmp/think-wide-t03-contract-final-verify.log`. Dependency-level `use client` bundling warnings are not suppressed.
- Q08 tests use independent fixtures and exercise unknown names/props/actions, all exact identity fields, nested references, revision/status mismatches, shape and version rejection, schema child limits, node/depth/byte boundaries, extreme depth, and duplicate editor bindings. These establish local rendering behavior, not live authorization.
- State tests exercise human draft preservation across rejection, valid editor removal/restoration, empty/unavailable transitions, and invalid preview rejection.
- Render tests exercise the six bindings, synthetic disclosures, script-like text escaping, unavailable excerpt suppression, invalid-view action suppression, and label/help associations.

## Adversarial review

The implementing assistant reviewed requirement alignment and the schema/renderer/state boundary. It specifically checked recursion before generated validation, full reference matching rather than entry-ID-only lookup, prototype-like object keys, revision/status spoofing, display-label substitution, fixed callbacks, unavailable excerpts, and draft lifetime.

Addressed during review: synthetic line ranges now match their actual fixture blobs; hashes are verified against displayed bytes; long contract text wraps; multiple editors sharing one mutable draft are rejected; duplicate TanStack field-validation messages are deduplicated.

CodeRabbit CLI 0.7.8 was installed and authenticated. Both runs used `coderabbit review --agent --uncommitted --include-untracked`:

- Initial review: completed across all 27 changed/new files, one minor finding about stale contract-migration status in this receipt. Confirmed and fixed. Log: `/tmp/think-wide-t03-coderabbit.ndjson`.
- Follow-up after the validation-message and documentation fixes: completed across all 27 files, **zero findings**. Structured final event reports `status: review_completed` and `outcome: completed`; no failed or unreviewed files were reported. Log: `/tmp/think-wide-t03-coderabbit-final.ndjson`.
- The implementing assistant's final adversarial pass found no further confirmed defect in the inspected local paths. Those reviews cover the pre-Acceptance version; a fresh pre-commit review is required below. Browser gaps below remain acceptance gaps, not review passes.
- Marc subsequently authorized finishing T03 and opening its PR. The Acceptance omission is corrected, with pre-commit check and review status tracked below.

## Browser evidence and remaining checks

Native Chrome opened the migrated workshop at `http://127.0.0.1:3001/workshop`. The accessibility tree contains all four semantic components, exact fixture metadata, synthetic labels and Contract 0.1.0 inspector. Theme toggle changed its accessible label to “Use light theme”. Empty submit produced the expected minimum-length error (duplicate display found and fixed).

The earlier port-3000 tab showed a stale hot-reload error during migration. A fresh dedicated dev server on loopback port 3001 rendered successfully. Port 3000 has both an IPv4 OrbStack listener and an IPv6 Node listener, so localhost is ambiguous here; no unrelated service was stopped.

Safari fallback provided usable desktop screenshots: light theme introduction, dark correction form and empty state were inspected. Mouse/accessible-control checks passed for theme switching, empty-submit validation (single error after the fix), unavailable excerpt suppression, empty state and return, inspector expansion, and rejection preserving the displayed composition. The Markdown download completed as `/Users/marcandy/Downloads/think-wide-synthetic-brief-2.md`; a filesystem comparison confirmed its contents exactly match the current synthetic brief (485 bytes).

Browser evidence remains **PARTIAL**: keyboard/type/paste actions were unreliable across browsers (including a clipboard timeout and a ScreenCaptureKit capture error), so valid decision submission, visible keyboard focus, and draft preservation through actual browser typing remain unverified. Responsive/mobile appearance and console inspection also remain unverified. Marc confirmed clicking/selecting the decision type and typing in Your direction. Full keyboard submission and draft preservation through view changes are still unverified. The automated state/render results do not substitute for those checks.

Remaining manual checklist: mobile width in both themes; Tab/Shift+Tab/Enter/Space navigation and focus; short/valid decision submission; typed draft across empty/unavailable/rejected and restored layouts; console/hydration errors.

Andrew (@adiesh2) reviews the diff and browser evidence before acceptance and integration. T03 is not DONE merely because local checks pass. T05/T06/T09 live sources and persistent decisions are later tickets, not blockers for this synthetic workshop.

## Theme provenance

User-supplied tweakcn `message.txt` SHA-256: `8f5d23726b04b6888297ef33441b9d410eb78921d9e871f8952e7605584c47a3`. Token values were preserved as supplied until the QA follow-up below, which changes the ones listed there. The Google Fonts import and the static contrast figures first recorded here are superseded by that section.

## Pre-PR completion pass

- Fixed the missing Acceptance option using the existing generated request kind. The canonical contract and generated files remain unchanged.
- Added tests comparing rendered choices against the canonical decision enum and preserving an acceptance draft through view replacement and preview, without promoting the finding status.
- `bun run typecheck`, `bun run test`, and the full `bun run verify`: passed after the Acceptance correction, 164 tests across 11 files. Frozen installation, contract drift, Biome, TypeScript and production build all passed. Log: `/tmp/think-wide-t03-pr-verify.log`.
- Post-Acceptance CodeRabbit review completed across all 28 changed/new local files (including the three documents excluded from the T03 commit): one documentation finding, no code findings. The premature completion wording was confirmed and corrected, and actual verification/review outcomes are now recorded. Structured result: `review_completed`, `outcome: completed`; no unreviewed files reported. Log: `/tmp/think-wide-t03-pr-review.ndjson`.
- Final adversarial inspection of the Acceptance fix and staged T03 scope is complete. The only subsequent changes record review outcomes; canonical contracts, generated output and dependencies remain unchanged.
- Adversarial inspection: runtime selection only accepts own keys of the exhaustive label map; prototype-like/unknown values cannot enter the draft through the selector. Action remains separate from topic/category and from finding status. Existing revision/reference checks and fixed callbacks are unchanged.
- The category proposal and personal planning notes remain local, outside the T03 commit. Category implementation will have a separate issue/PR, as agreed by Marc and Eassa.

### Final pre-commit CodeRabbit disposition

Confirmation run completed over all 28 local files with `outcome: completed` and no unreviewed files reported (`/tmp/think-wide-t03-pr-review-confirm.ndjson`). It did not repeat the documentation finding. One minor finding remains explicitly deferred to T03 issue #3's theme review: the supplied secondary background/foreground pair is 3.16:1, below 4.5:1 for normal text. No workshop/catalog/route uses `variant="secondary"`, `bg-secondary`, or `text-secondary`; the supplied tokens are preserved. Interim rule: correct this pair with the theme reviewer before introducing any secondary variant or normal text using it. This is a documented unused-token limitation, not a claim of full accessibility compliance.

No source-code changes followed the completed reviews or the 164-test verification run. Only this outcome record was finalized before the commit.

## Follow-up: T06 integration and inspector feedback

Integrated main at `41e73ad` (PR #12) and Eassa's T03 QA commits `24e53e8` and `3f66c61`. The QA commits supersede the earlier minimum-length and unchanged-theme statements: decisions now require nonempty text, the heading is fixed with agent suggestions labeled separately, and input/focus tokens were adjusted for contrast. Backend, dependencies, and shared instructions match main unchanged.

Marc reported that rejected-composition feedback appeared far above its controls. Both rejection and success feedback now appear inside the inspector, immediately after its buttons. Composition feedback is separate from decision/download feedback; applying or rejecting a layout preserves the draft and decision preview. Help text explains that applying JSON changes only the local layout.

- `bun run verify`: exit 0, 225 tests across 13 files, frozen install, no contract drift, Biome, TypeScript and build passed. Log: `/tmp/think-wide-t03-sync-verify.log`.
- Own adversarial review: checked integration against main, valid/rejected transitions, stale feedback clearing, draft/preview preservation and accessible feedback placement. No further confirmed defect found in these changes.
- Safari desktop interaction: clicked Try a rejected view and then Apply composition. Screenshots confirmed rejection directly beneath the buttons and replacement by success feedback; keyboard focus remained visibly outlined. This does not complete the remaining mobile/keyboard/draft acceptance checklist.
- Additional CodeRabbit integration review was still running when Marc changed the policy to require CodeRabbit at PR readiness rather than every commit. It was stopped before completion; no pass is claimed for this incremental diff. The completed pre-PR reviews above remain the recorded CodeRabbit results for PR #13's original implementation.

Status remains fixtures only for the workshop. T06's integration does not connect this UI to durable decisions. Marc's notes and the separate category proposal remain local and excluded from this PR.

## QA follow-up: self-hosted fonts, contrast, repo sync (September 20, 2026)

Status level for everything in this section: **fixtures only**, computed or fetched with curl. No browser was opened. `origin/main` (T06 backend) was merged into the branch first; the merged state passed `bun run verify` (13 files, 224 tests) before any change. Marc's concurrent commit `b5da6e4` (the follow-up above) landed on the branch while this work was in progress and was merged in afterwards; the only conflict was this file, resolved by keeping both sections.

### Fonts

`src/styles.css` no longer imports `fonts.googleapis.com`. Outfit comes from `@fontsource-variable/outfit` 5.3.0 (`wght.css`; one variable file covers the 400/500/600/700 in use; the family registers as `"Outfit Variable"`, so `--font-sans` is now `"Outfit Variable", Outfit, sans-serif`). Space Mono comes from `@fontsource/space-mono` 5.3.0 (`400.css` only; 700 and italic were requested from Google but nothing in `src/` uses them). Outfit has no italic; `.connection-caveat` was and still is a synthesized oblique.

Checked: after `vite build`, `.output/public/assets/styles-*.css` contains five `@font-face` rules whose `src` is `/assets/*.woff2`; five `.woff2` files (plus three `.woff` fallbacks for Space Mono) are emitted; `grep -r "fonts.googleapis\|fonts.gstatic" .output/public src` returns nothing. Dev server on port 3101: `GET /workshop` 200 and `GET /src/styles.css` 200, neither contains an external font host; the Outfit `.woff2` URL from the served CSS returned 200 `font/woff2` (32292 bytes). The server was stopped afterwards.

### Contrast, recomputed from the current tokens

WCAG 2.x relative luminance; `token/NN` is composited over the backdrop it is actually painted on. "Before" is the branch as of `3f66c61`. The earlier pass measured the dark outline Button at 4.24:1 and then lightened dark `--input` to `#839496`, which lightened the `input/30` fill; the real figure before this fix was 3.56 (page) and 3.18 (card).

| Pair | Light before | Light now | Dark before | Dark now | Needs | Pass |
|---|---|---|---|---|---|---|
| Body text on page | 12.05 | 12.05 | 5.61 | 8.07 | 4.5 | yes |
| Text on a card | 10.61 | 10.61 | 4.86 | 6.99 | 4.5 | yes |
| Primary Button, `::selection` | 4.55 | 5.20 | 4.55 | 4.55 | 4.5 | yes |
| Primary Button hover (`primary/90` over page) | **4.01** | 4.55 | 5.28 | 5.28 | 4.5 | yes |
| Outline Button text, page (dark: `input/30` over page) | 12.05 | 12.05 | **3.56** | 5.12 | 4.5 | yes |
| Outline Button text, card (dark: `input/30` over card) | 12.05 | 12.05 | **3.18** | 4.57 | 4.5 | yes |
| Outline Button hover, page / card | 4.61 / 4.61 | 4.61 / 4.61 | 6.83 / 6.30 | 6.83 / 6.30 | 4.5 | yes |
| Ghost Button hover, page / card | 4.61 / 4.61 | 4.61 / 4.61 | 9.49 / 8.82 | 9.49 / 8.82 | 4.5 | yes |
| Textarea text and placeholder | 12.05 | 12.05 | **3.56** | 5.12 | 4.5 | yes |
| Secondary Button (unused) | **3.16** | 4.75 | **3.16** | 4.63 | 4.5 | yes |
| Secondary Button hover (unused) | **2.53** | 5.94 | **4.20** | 5.82 | 4.5 | yes |
| Muted surface (unused) | 4.86 | 4.86 | **2.01** | 4.90 | 4.5 | yes |
| Pink headline accent, brand dot (large text) | 4.21 | 4.82 | 3.30 | 4.52 | 3 | yes |
| `.note-number` on the intro card (large text) | 3.71 | 4.25 | **2.86** | 3.91 | 3 | yes |
| Pink icons on the page | 4.21 | 4.82 | 3.30 | 4.52 | 3 | yes |
| Field and outline Button border, page | 4.13 (field), **2.93** (Button) | 4.13 | 4.75 | 4.75 | 3 | yes |
| Outline Button border, card | **2.58** | 3.64 | 4.11 | 4.11 | 3 | yes |
| Invalid field border | 4.29 | 4.29 | 3.25 | 3.25 | 3 | yes |
| Focus ring, page / card | 4.21 / 3.71 | 4.21 / 3.71 | 4.52 / 3.91 | 4.52 / 3.91 | 3 | yes |

Links, eyebrows, pills, labels, field help and field errors all inherit `--foreground`, so they are the first two rows. Disabled controls are exempt.

Token changes (`src/styles/theme.css`, each with its ratio in a comment): light `--primary` `#d33682` to `#c72b76`; light `--secondary-foreground` `#ffffff` to `#002b36`; dark `--foreground`, `--card-foreground`, `--popover-foreground`, `--muted-foreground` `#93a1a1` to `#b6c0c0`; dark `--secondary` `#2aa198` to `#21827a`; dark `--muted` `#586e75` to `#0a4f61`; new `--primary-text` (light `#c72b76`, dark `#e0609b`). In dark no single pink is both 4.5:1 under white text and 3:1 on a card, so the five `color: var(--primary)` uses in `workshop.css` now use `--primary-text`; dark `--primary` itself is unchanged. One rule a token cannot express: `globals.css` puts the outline Button border on `--input` in light as well as dark. The dark text colour is the most visible change: it is lighter than Solarized base1, because no darker value reaches 4.5:1 on shadcn's `input/30` control fill.

Enforcement: `tests/render/theme-contrast.test.ts` parses `:root` and `.dark`, composites alpha, and asserts the 24 pairs above plus the presence of the two CSS rules they rely on. Restoring the old dark `--foreground` and light `--primary` was tried and fails four tests. `CONTRAST_TABLE=1 bunx vitest run tests/render/theme-contrast.test.ts` prints the table. This is arithmetic on tokens, not a rendered accessibility audit.

### Repo sync

Removed the `generate-routes` script (`tsr generate` rewrites `src/routeTree.gen.ts` without the `declare module '@tanstack/react-start'` footer that the `tanstackStart()` Vite plugin emits) and the `@tanstack/router-cli` devDependency, which nothing else referenced. `tsr.config.json` stays: `@tanstack/router-generator`'s `getConfig`, which the Start Vite plugin calls, reads it. After the removal `vite build` left `src/routeTree.gen.ts` unchanged. `docs/REPO_MAP.md` now lists the styles split, the workshop files, `registry.tsx` and the four T03 tests.

### Verification

`bun run verify` exit 0 on the final state, after merging `b5da6e4`: frozen install, no contract drift, Biome, TypeScript, 251 tests in 14 files, production build. (250 before that merge; its one new state test accounts for the difference.)

### Still UNVERIFIED (NOT RUN in a browser)

- Hydration and console errors on `/` and `/workshop`.
- Rendered focus appearance (outline visibility on every control, both themes) and hover colours.
- Real font loading and rendering in a browser, including the fallback swap and offline behaviour.
- Mobile layout in both themes.
- iOS Safari focus zoom on the select and textareas.
- Everything in the "Remaining manual checklist" above.
||||||| merged common ancestors
