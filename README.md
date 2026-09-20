# Think-Wide

Cross-repository evidence, durable human decisions, and implementation briefs for people and coding agents, exposed as MCP tools and a web workbench. Think-Wide reasons across projects; coding agents implement inside them. It never edits, builds, tests, or deploys the repositories it reads.

Built during the Coffee & Code Agent hackathon, September 20, 2026. Planning material written before the build window is in [`docs/`](docs/00_START_HERE.md) and is disclosed as prior design work. Application code starts with this repository.

## Setup (Linux, macOS, Windows via WSL2)

Needs [Bun](https://bun.sh) 1.4+, Docker, git.

```bash
bun install --frozen-lockfile
bun run convex:up                 # self-hosted Convex on 127.0.0.1:3210 (dashboard :6791)
cp .env.example .env.local
bun run convex:key                # paste the output into CONVEX_SELF_HOSTED_ADMIN_KEY in .env.local
bun run convex:dev                # pushes convex/ functions, regenerates convex/_generated, watches
bun run dev                       # http://localhost:3000
```

Before every push: `bun run verify` (same command CI runs).

Only Eassa changes `package.json` / `bun.lock`. Everyone else installs with `--frozen-lockfile`.

## Where things go

See [`docs/REPO_MAP.md`](docs/REPO_MAP.md) for every path and the ticket that owns it.

| Folder | What |
|---|---|
| `contracts/` | hand-written OpenAPI + JSON schemas, the public contract |
| `generated/` | types and validators generated from `contracts/`, never edited |
| `core/` | pure TypeScript rules: grants, revisions, evidence refs, handoffs |
| `convex/` | Convex schema, queries, mutations, actions |
| `src/` | TanStack Start web app (`routes/`, `components/`) and trusted Node server (`server/`) |
| `tests/` | fixtures and acceptance cases Q01–Q18 |
| `infra/` | pinned Convex compose file, deployment config |
| `docs/` | plan, decisions, sanitized evidence |

## Status

Initialized with the official TanStack CLI (add-ons: convex, shadcn, form, nitro, biome). `convex/todos.ts` and its schema are scaffold demo code, kept only as the local read/write smoke test until ticket T02 replaces them. No product capability is implemented yet; every acceptance case in `docs/05_SECURITY_AND_CI.md` is NOT RUN.
