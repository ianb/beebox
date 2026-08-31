---
title: "Production Codex session startup and authentication"
status: partial
workstream: codex-session-startup-auth
issues: []
---
# Production Codex session startup and authentication

Bee Box production cannot start a Codex chat because the service account has no Codex CLI. After that prerequisite is fixed, the same account also needs a supported Codex login and an actionable run-path preflight. This plan makes the complete startup path provisioned, tested, and diagnosable without widening secret custody.

**Issues addressed:** none. Searches for `codex`, `plugin`, `authentication`, and the exact user-visible error found related completed issues and the open intermittent thread-start issue, but no queue item for the deterministic production provisioning failure.

## Stated preferences this plan trades against

- Engineering principle 3 requires validation at process and environment boundaries. The Codex executable, its version, plugin commands, and login status are external-process boundaries.
- Engineering principle 4 says: *"Every catch block either rethrows, returns a typed failure, or logs"* and requires enough context to debug a failure from its log line. A single generic plugin-install message does not meet that standard.
- Engineering principle 5 keeps typed exceptions when callers cannot recover but must preserve cause and category.
- Engineering principle 6 concentrates defenses at real boundaries. This plan probes the CLI and credentials, not interior SDK states already promised by types.
- Engineering principle 8 requires one way to perform each operation. Chat and batch Codex runs must share one readiness check.
- Engineering principle 10 requires a red-capable seam before the fix. The existing injected Codex command seam is reused.
- `CLAUDE.md` says: *"Reproduce complete user-visible paths; distinguish focused success from host flakes, simulator, browser, physical-device, deployed-runtime, reload, and production verification."* The rollout therefore separates packed/deployment-shaped verification from a production chat canary.
- `CLAUDE.md` says: *"NEVER disable or weaken a lint rule to make code pass."* No lint configuration changes are part of this work.

## What already exists

- `src/core/agent/ensure-codex-plugin.ts:58-68` defines `CodexPluginInstallError` and runs `execFileAsync("codex", args)`. Reuse the installer and its injected `CodexCommand` seam.
- `src/core/agent/ensure-codex-plugin.ts:85-154` distinguishes unreadable, absent, and installed plugin state, repairs global marketplace registration, then wraps any terminal failure. Preserve that decision core; improve prerequisite validation and error detail around it.
- `test/core/agent/ensure-codex-plugin.doctest.md:1-185` covers global marketplace ownership, repair, cachebuster versions, and typed terminal failure. Extend it rather than creating another plugin test tier.
- `src/core/agent/auth-preflight.ts:105-122` has the shared chat preflight, but line 112 explicitly returns early for Codex: `if (params.engine === "codex" || params.backend.requiresClaudeAuth !== true) return true;`. Generalize this provider boundary without copying Claude-specific behavior.
- `src/services/claude-cli.ts:21-69` puts CLI status behind an injectable service; `src/core/agent/auth-preflight.ts:52-60` injects it and caches successful probes. Follow that shape with Codex-specific parsing, commands, and a positive-result TTL.
- `src/services/codex-chat.ts:93-120` installs the plugin before creating the SDK session and reports failures as phase `session-start`. Keep the phase contract; make its underlying message actionable.
- `src/core/agent/codex-run.ts:60` also installs the plugin before a batch run. Route both call sites through the same readiness function.
- `src/hub/child-env.ts:42-83` allowlists `PATH` and `HOME` into box children. Production evidence confirmed children receive `PATH=/home/beebox/.local/bin:/usr/local/bin:/usr/bin:/bin` and `HOME=/home/beebox`; no new credential environment variable is required for service-account login.
- `deploy/setup-server.sh:137-138` installs Claude for root and the Bee Box user, but contains no Codex install. Add Codex provisioning for the Bee Box user at this existing tool-install boundary.
- `deploy/README.md:329-339` documents service-account Claude subscription login. Add the parallel Codex operator procedure while keeping each provider's supported command and store separate.
- `src/services/codex-sdk-session.ts:207-212` constructs the SDK runtime and already supports a `BBX_CODEX_BINARY` override. `src/services/codex-history-server.ts:62` separately defaults to `codex` on `PATH`. These paths must converge on the same pinned binary used for plugin commands.
- Production inspection confirmed `.codex-plugin/plugin.json`, `hooks/hooks.json`, and `scripts/run-bbx.sh` are deployed, so missing plugin files are not the current defect.

## Prior art (external)

- The installed Codex CLI exposes `codex login status`, `codex login --device-auth`, `codex login --with-api-key`, and `codex login --with-access-token`. A clean `CODEX_HOME` makes `codex login status` print `Not logged in` and exit 1. The service flow will use the CLI's own login store rather than inventing a Bee Box credential file.
- Official OpenAI documentation search did not expose a specific indexed page for noninteractive Linux service-account login or plugin marketplace provisioning. Treat the installed CLI contract and pinned-version deployment probe as the executable authority; do not claim an undocumented refresh-token copying contract.
- Existing Bee Box precedent uses a one-time service-account subscription login for Claude and keeps API keys out of the child environment (`deploy/README.md:329-339`). Reuse the custody boundary, not Claude's commands or file format.

## Tracks / scope

### Track 1 — One authoritative Codex binary

**What.** Expose the already-installed, SDK-version-matched `@openai/codex` binary to the `beebox` service and route plugin commands, history app-server, and SDK turns through it.

**Why this needs to change.** The production service `PATH` cannot find `codex`, while the deployed workspace already contains `@openai/codex` `0.147.0` under `/opt/beebox/node_modules`. Installing a second CLI version would let one binary write auth/plugin state that another binary reads.

**Direction.** Treat the direct `@openai/codex-sdk` pin and its matching `@openai/codex` dependency as one runtime release. Add the workspace `node_modules/.bin` directory to the hub service `PATH`, which box children already inherit. Resolve and pass the same executable explicitly where practical so the SDK override, history server, and plugin installer cannot drift. Add a deployment verifier that runs version and help/subcommand checks in a scratch `CODEX_HOME`; it must not fail on or mutate a real stale marketplace. A missing login is an expected readiness result, not a provisioning failure.

**Vocabulary lock-ins.** `Codex CLI unavailable`, `Codex CLI incompatible`, `Codex authentication required`, and `Codex plugin installation failed` are distinct operator/user failure categories.

**First implementation chunk.** Add a failing deployment-environment test proving the workspace Codex binary is installed but absent from the service `PATH`, then add the path wiring and scratch-home compatibility checks.

### Track 2 — Provider-aware Codex readiness and authentication

**What.** Add an injectable Codex CLI service and a shared readiness check used by chat and batch runs.

**Why this needs to change.** Current chat preflight bypasses Codex, production has no `.codex` state, and plugin installation hides an absent executable as a plugin failure.

**Direction.** Model Codex readiness as a discriminated result from the external process boundary: CLI unavailable, authentication required, probe inconclusive, plugin failure, or ready. Probe `codex login status` before mutating plugin state and cache a positive result for ten minutes, matching Claude's existing preflight cost control. Do not cache logged-out or inconclusive results. An inconclusive probe logs redacted detail and lets the SDK report its runtime state; it does not falsely diagnose a version mismatch. Do not inspect or copy credential files. Do not accept `OPENAI_API_KEY` from the ambient hub environment as an implicit fallback.

**Vocabulary lock-ins.** `CodexReadinessError` is the user-facing typed exception. Provider-specific CLI services remain separate; the shared orchestration dispatches by engine rather than pretending Claude and Codex auth responses have one wire shape.

**First implementation chunk.** Add red doctests for spawn `ENOENT`, incompatible plugin command, logged-out status, cached successful status, and successful login followed by plugin install. Then implement the Codex CLI service and readiness orchestration.

### Track 3 — Complete startup and deployment-shaped verification

**What.** Exercise CLI discovery, login status, plugin registration, SDK thread startup, and hook execution in the environments that ship.

**Why this needs to change.** The current plugin doctest injects a fake command and cannot prove the standalone CLI is provisioned, authenticated, or usable under systemd's environment.

**Direction.** Keep focused doctests for decisions. Add one deployment-shaped test using a temporary HOME/CODEX_HOME and the workspace-pinned CLI to assert service environment wiring and precise failure propagation. After deployment, run an authenticated production canary as the `beebox` user and then through the real web-chat path. Record plugin and login status without printing secrets.

**Vocabulary lock-ins.** Verification reports use `focused`, `packed/deployment-shaped`, and `production web-chat` explicitly.

**First implementation chunk.** Create the deployment-shaped red test that reproduces a spawn `ENOENT` under the production `PATH` contract even though the workspace-pinned binary exists.

## Could this be simpler?

The simplest fix is to add the existing workspace `node_modules/.bin` to the service `PATH` and complete a manual login. That clears today's spawn `ENOENT` without installing another binary. The fuller plan adds a cached auth preflight, precise boundary errors, and deployment checks so a rebuild or dependency change cannot silently regress it, as required by principles 3, 4, and 10. It does not add an Admin login UI or a new secret store.

## Subplans

None. The cross-model review exposed and resolved the two-binary question: the SDK-matched workspace dependency is the sole runtime authority. Authentication remains in its supported service-account store.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Codex executable is absent from the service `PATH` | Planned deployment-shaped test | Planned typed readiness error | Clear |
| Workspace Codex version lacks plugin commands | CLI-service doctest and scratch-home deploy check | Deployment fails before restart | Clear |
| Plugin/login state is written by a different Codex version than the SDK executes | Planned single-binary path assertions | All call sites use the workspace-pinned binary | Clear test failure |
| Service account is not logged in | Planned auth doctest | Planned authentication-required error and operator procedure | Clear |
| `codex login status` output changes or is unparseable | Planned parser doctest | Planned inconclusive/incompatible result with stderr context; no cache | Clear |
| Marketplace registration is missing or stale | Existing installer doctest | Existing repair path | Clear in logs; user category improved |
| Plugin add fails after successful login | Existing terminal-failure test, strengthened | Typed plugin failure preserving cause | Clear |
| Hook cannot find `bbx` | Existing context-mirror tests; planned production canary | `run-bbx.sh` exits 127 with workspace detail | Clear |
| CLI is installed but SDK cannot start a thread | Existing session-start phase reporting; planned canary | SDK error remains session-start, distinct from readiness | Clear |
| Auth credentials leak through logs or child env | Planned negative assertions | Credentials remain in Codex's store; no env propagation | Clear test failure |

There is no unresolved critical gap in the planned local loop. Production authentication still requires the boxholder to complete the provider-supported login once; the implementation must stop with an explicit operator instruction until that external action occurs.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED:** no agent-authored vocabulary or card field is added.
- **Stale ref — ADDRESSED:** plugin marketplace stale-root handling already re-registers in `ensure-codex-plugin.ts:85-149`.
- **Two agents touching the same card — ADDRESSED:** no card mutation occurs. Plugin install remains process-memoized and Codex commands are idempotent.
- **Hand-edit drift — ADDRESSED:** no Bee Box credential config is hand-edited. The Codex CLI owns its credential format.
- **Fabricated free-form value — ADDRESSED:** status is parsed from command output and never inferred from file presence.
- **Validation error UX — ADDRESSED:** failure categories name the failed boundary and preserve cause in logs.
- **Partial migration / transition state — ADDRESSED:** Claude continues unchanged. A Codex box reports explicit readiness failures until both CLI and login are present.

## NOT in scope

- A browser-based Codex login UI. The first production repair uses the supported CLI flow under the service account.
- Copying developer workstation Codex credentials to production. That would cross a secret-custody boundary and rely on an undocumented file format.
- Reusing `THINKING_OPENAI_API_KEY` or `BBX_OPENAI_API_KEY`. Those keys belong to transcription/search and must not silently change agent billing.
- Changing Codex models, quotas, transcript behavior, or retry policy.
- Refactoring Claude authentication beyond the dispatch needed to preserve its current behavior.
- Reworking global marketplace ownership. The existing completed issue and tests already cover that mechanism.

## Open design questions

None before implementation. The boxholder must choose or complete the supported production login when the code reaches the rollout gate; that is an external credential action, not an implementation design question.

## Knowledge audits

Skipped. This is deployment and runtime infrastructure; it adds no concept a box agent must know directly.

## What will hold this after it ships

- Pure/parser doctests hold Codex login-status interpretation and readiness categories.
- The existing plugin doctest holds marketplace decisions and terminal cause preservation.
- A deployment/setup shell test holds the pinned CLI installation and service `PATH` contract.
- A chat/backend doctest holds provider-aware preflight and user-visible phase copy.
- The production web-chat canary verifies the shipped system but is not the regression anchor.

## Implementation order

1. Land this plan and its cross-model review findings in the worktree.
2. Add red single-binary path and deployment-shaped tests.
3. Add red Codex login/readiness and chat-preflight doctests.
4. Implement service path/explicit binary convergence and deployment verification.
5. Implement the Codex CLI service, typed readiness errors, and shared chat/batch orchestration.
6. Update deployment/operator documentation.
7. Run focused, packed/deployment-shaped, and full relevant test suites.
8. Cross-model review the implementation and resolve findings.
9. Deploy only after the boxholder authorizes shipping; complete service-account login, then verify the production web-chat path.

## Rollout shape

Tests landed red first at each boundary. Local implementation is complete: the focused CLI/auth/plugin/chat tests, real package-pinned executable probe, all 173 selected changed tests, typecheck, lint, shell syntax, and documentation checks pass. Production rollout remains intentionally open and two-stage: merge/deploy the executable and diagnostics, then complete `beebox`-user login through the supported Codex CLI flow and run a real Codex chat. A production canary is not claimed until the browser-visible turn completes and the plugin hooks run without error.
