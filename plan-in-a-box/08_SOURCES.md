# Source and decision register



**Research date:** September 20, 2026. Sources below were opened/read through web or the named connector. Documentation verified is not package installed, code executed, account enabled, or integration passed.



## Primary sources

### S01: Hackathon rules and timing

Devpost connector overview, rules and key dates retrieved September 20, 2026 around 11:53 UTC. Overview build start is 11:10 EDT; structured submissions open 10:00. TCR details and prior-work disclosure were retrieved from the connector. This plan does not resolve organizer ambiguity or establish individual eligibility.

- [https://coffee-and-code-agent.devpost.com/](https://coffee-and-code-agent.devpost.com/)

- [https://coffee-and-code-agent.devpost.com/rules](https://coffee-and-code-agent.devpost.com/rules)



### S02: Google Open Knowledge Format

Inspected main-branch spec labels itself Version 0.2. Markdown/frontmatter and optional directory indexes/cross-links support progressive navigation; storage/query infrastructure is a non-goal. Main is not an immutable release pin. No OKF package installed; no 0.2.0 runtime claim.

- [https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)



### S03: Git tree inspection

Primary reference for exact tree enumeration, object identity and NUL-delimited output. The proposed portfolio representation is our design, not a Git feature.

- [https://git-scm.com/docs/git-ls-tree](https://git-scm.com/docs/git-ls-tree)



### S04: Git object reading

Primary reference for object type/size/content and batch reading. Exactness, authorization, range handling and safe invocation still require application tests.

- [https://git-scm.com/docs/git-cat-file](https://git-scm.com/docs/git-cat-file)



### S05: Convex actions

Actions access data through query/mutation calls and can use supported runtimes. External effects are not automatically retried safely. Our bounded admissions and publication checks are application design.

- [https://docs.convex.dev/functions/actions](https://docs.convex.dev/functions/actions)



### S06: Convex scheduled functions

Atomic scheduling from mutations differs from scheduling from actions. Scheduled user identity and cancellation need explicit treatment. This is not proof of exactly-once external issue creation.

- [https://docs.convex.dev/scheduling/scheduled-functions](https://docs.convex.dev/scheduling/scheduled-functions)



### S07: Self-hosted Convex

Official route for running the backend on owned infrastructure. Actual GalaxyGate allocation, image digest, volume, exposure and restoration were not inspected.

- [https://docs.convex.dev/self-hosting](https://docs.convex.dev/self-hosting)



### S08: Convex custom JWT

Configured issuer/JWKS/algorithm and application audience are verifier inputs. No actual WorkOS token profile or hosted backend was tested here.

- [https://docs.convex.dev/auth/advanced/custom-jwt](https://docs.convex.dev/auth/advanced/custom-jwt)



### S09: Convex indexes

Ordered database indexes support scoped queries. Our repository/snapshot/parent keys and bounded result policy are proposed design, not vendor-supplied authorization.

- [https://docs.convex.dev/database/reading-data/indexes](https://docs.convex.dev/database/reading-data/indexes)



### S10: Convex text search

Tokenized full-text search is different from exact byte/code search. Literal source inspection remains a separate operation.

- [https://docs.convex.dev/search/text-search](https://docs.convex.dev/search/text-search)



### S11: ast-grep JSON and rule tests

Structured match results and rule fixtures support reproducible structural discovery. No rule binary was installed/run in this pass. Context7 examples include rewrite modes; do not copy rewrite flags into read-only tools.

- [https://ast-grep.github.io/guide/tools/json.html](https://ast-grep.github.io/guide/tools/json.html)

- [https://ast-grep.github.io/guide/test-rule.html](https://ast-grep.github.io/guide/test-rule.html)



### S12: Agent Skills format

Instructions and supporting references can be loaded progressively. Native host loading and server guidance tools are different integration routes; neither confers authority.

- [https://agentskills.io/specification](https://agentskills.io/specification)



### S13: Theme and component styling

Tweakcn is the requested theme-selection surface. The extracted page had no text; no preset was selected or verified. shadcn documents semantic CSS variables. Review the actual export during the event.

- [https://tweakcn.com/](https://tweakcn.com/)

- [https://ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming)



### S14: TanStack Start

Primary framework documentation inspected. Resolve compatible Start/Router/Form/React artifacts and actual initialization steps at P0; no scaffold or package tuple is shipped in this box.

- [https://tanstack.com/start/latest/docs/framework/react/overview](https://tanstack.com/start/latest/docs/framework/react/overview)



### S15: CopilotKit A2UI

Catalog-based composition fits the proposal. Context7 provided current custom-catalog examples with differing import surfaces; actual installed exports and wire compatibility are a gate, not inferred from examples.

- [https://docs.copilotkit.ai/generative-ui/a2ui](https://docs.copilotkit.ai/generative-ui/a2ui)



### S16: Blacksmith runners

GitHub Actions runner options are documented. No Blacksmith account, integration, workflow or credentials were inspected or configured.

- [https://docs.blacksmith.sh/blacksmith-runners/overview](https://docs.blacksmith.sh/blacksmith-runners/overview)



### S17: GitHub Actions secure use

Primary guidance for reviewed action pins, least privilege, and untrusted code boundaries. The proposed CI is not a prebuilt YAML file.

- [https://docs.github.com/en/actions/reference/security/secure-use](https://docs.github.com/en/actions/reference/security/secure-use)



### S18: Bun 1.4.2

The release page exists and was inspected. The requested version remains a candidate to prove with the actual project. Runtime/build/package benefits do not make source input trustworthy or replace typechecking.

- [https://bun.sh/blog/bun-v1.4.2](https://bun.sh/blog/bun-v1.4.2)



### S19: TypeScript 7

Official release material states TS7 native tooling and compiler-API compatibility limitations. Keep generators on compatible APIs where necessary; do not assume the checker and programmatic compiler API are interchangeable.

- [https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)



### S20: OpenAPI type generation

Primary tooling documentation for OpenAPI type generation. Our supported schema profile and operation exposure decisions must be authored and checked during the event.

- [https://openapi-ts.dev/introduction](https://openapi-ts.dev/introduction)



### S21: Ajv standalone validation

Build-time validator generation yields code that still validates at runtime. Standalone compilation is not proof arbitrary inputs are valid.

- [https://ajv.js.org/standalone.html](https://ajv.js.org/standalone.html)



### S22: WorkOS MCP

WorkOS documents protected-resource discovery, resource indicators and token verification. Actual environment permissions/configuration remain untested. No WorkOS credentials were read.

- [https://workos.com/docs/authkit/mcp](https://workos.com/docs/authkit/mcp)



### S23: MCP and OpenAI integration

Official spec, SDK migration material and OpenAI tool-server documentation inspected. A main-branch symbol is not proof an installed artifact exports it. Public tool compatibility, OAuth and embedded UI are separate acceptance cells.

- [https://modelcontextprotocol.io/specification/2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)

- [https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)

- [https://developers.openai.com/plugins/build/mcp-server](https://developers.openai.com/plugins/build/mcp-server)



### S24: Claude remote connectors

Remote custom connector route is documented. No account/host connection was made. A loopback-only server is not a remote service available to the consumer host.

- [https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)



### S25: GitHub App installation credentials

Installation tokens can be narrowed to granted repositories/permissions and expire. Application-user entitlement and downstream audience must still be checked separately.

- [https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)



### S26: GitHub issue API

Provider endpoint for issue creation. The plan does not assume an idempotency-key guarantee; approvals, effect reservation and unknown-outcome reconciliation remain application responsibilities.

- [https://docs.github.com/en/rest/issues/issues#create-an-issue](https://docs.github.com/en/rest/issues/issues#create-an-issue)



## Supplied team evidence

**F01: message.txt**, 38 supplied lines. Andrew's WorkOS/gateway/Convex and A/B isolation priorities, current-token mapping, current-grant and downstream-effect expectations. This plan preserves those constraints but removes its conditional repair execution work from product scope.

**F02: notes.txt**, 17 supplied lines. Reports 28 local workstation readiness checks, Bun 1.3.14 mismatch, ast-grep not on PATH, and hosted WorkOS/Convex/deployment not tested. This is reported supplied-file evidence, not a new verification of Andrew's laptop.



## New design decisions in this box

The latest user request is authoritative for the scope change. Remove source-repair/executor functionality; keep bounded read analysis. Use a single coordinator and issue queue. Treat the hierarchy as indexed metadata, with optional OKF export only. Preserve agent-facing tool depth, exact references and durable decisions. Make local fallback non-public. Protect the 15:00 recording and 16:00 feature freeze.



These are engineering recommendations tailored to the request, not claims made by Google, Convex, WorkOS, GitHub, OpenAI or Anthropic.



## Remaining real-world facts

Actual repo, build start/selected track confirmation, public GitHub identity, account grants, approved model budget, chosen theme, resolved package/lockfile, self-hosted image and storage, accepted token profile, and host interoperability must be established during initialization. They are not fabricated into the task seeds. No legal or organizational eligibility ruling is made.



## What this research did not do

No application dependencies installed, source test run, model/API execution, GitHub write, source import, WorkOS/Blacksmith configuration, VPS inspection, deployment, or submission. This box deliberately contains no application implementation to test. Packaging/document QA is documented separately in 09_PACKAGE_QA.md.
