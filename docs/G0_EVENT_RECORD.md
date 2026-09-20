# G0: event boundary and first acceptance

Recorded by the PM session on Eassa's laptop, 2026-09-20 11:35 EDT. Items marked UNCONFIRMED are not facts yet; the named person replaces them with a source.

## Event

| Item | Value | Source |
|---|---|---|
| Event | Coffee & Code Agent hackathon | docs/08_SOURCES.md S01 |
| Build block | 11:10–18:00 EDT, 2026-09-20 | S01 (organizer overview) |
| Early initialization | Organizers told Eassa verbally that repo init and dependency setup before 11:10 was acceptable | **UNCONFIRMED in writing.** Eassa: paste the organizer message or name + time here |
| Track | **UNCONFIRMED.** Eassa to state. Plan assumes Code Registry constraints apply (17:30 code stop, sync before 18:00) until told otherwise | — |
| Submission | Devpost, opens 10:00, closes 18:00 EDT | S01 |

## Repository

| Item | Value |
|---|---|
| URL | https://github.com/freebatteryfactory/think-wide-hackathon (public) |
| Created | 2026-09-20 09:49 EDT (GitHub API `created_at` 2026-09-20T13:49:43Z). Renamed once the same day from `think-wide` to add "hackathon" |
| Trunk at G0 | `bc3a418` on `main`, CI green (run 35518318766) |
| Pre-window commits | `30d77b8` (09:5x, planning docs only) and `bc3a418` (11:02, tool scaffolds + config, no product logic). Both before 11:10 under the verbal ruling above. Not backdated, not squashed |

## Disclosure of prior work

- `docs/` planning package (architecture, tickets, acceptance specs) was written before the event. It contains no application code. The product was called "Revive" in that material until renamed Think-Wide on the morning of 2026-09-20.
- An earlier prototype/starter kit exists outside this repository. It is **not** copied, imported, or used as a source here.
- Infrastructure that predates the event: one VPS (also hosting an unrelated project of Eassa's), WorkOS account, GitHub org. No code from them.
- Libraries and scaffolds: official TanStack CLI output (add-ons convex, shadcn, form, nitro, biome), listed in `package.json`. `convex/todos.ts` is scaffold demo code pending replacement in T02.
- AI coding tools (Claude Code and others) are used by all three teammates, including this coordinator session.

## Mode and data

- Current mode: `local-demo`. Self-hosted Convex on each developer's loopback. Hosted identity, remote MCP, and deployment: NOT RUN.
- Demonstration repositories: **UNCONFIRMED.** Must be public or synthetic and clearly labeled. Owner: Marc (needed by T05, 13:30).
- Model provider and budget for backend reasoning: **UNCONFIRMED.** Owner: Eassa (needed by T10, 15:00).

## First acceptance (agreed sentence)

Two immutable repos, one cross-project discovery, one exact evidence expansion, one retained correction that changes reasoning, one reopened investigation, and one useful implementation brief. One authenticated remote MCP host if its gate passes; a local demo is never relabeled as that result.

## Team and first tasks

| Person | GitHub | First ticket |
|---|---|---|
| Eassa | @heyoub | T01 close-out, then T02 |
| Marc | @Marcandy | T03 |
| Andrew | @adiesh2 (assumed from repo access; correct if wrong) | T04 |

Late-start note: G0's 11:25 hard stop passed before this record was written. Per PM_BOOT the clock is not reset; T01/T02/T03/T04 keep their original hard stops.
