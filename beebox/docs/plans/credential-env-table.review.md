# Plan review — credential-env-table

Reviewer: codex gpt-6-astra, effort high, round 1, 2026-10-29. Six findings,
summarized; then the adjudication.

## Findings

1. **P1. The table cannot represent the distinctions the brief requires.**
   `hubChild` mixes the spawned child (`hubExtras` inject `BBX_HUB_SECRET`,
   `hub/supervisor/child-spawn.ts:90`) with `box.env` (no extras,
   `hub/box-env-file.ts:42`). `claudeEngine` has no per-provider cells
   (`ANTHROPIC_API_KEY` is blank for OpenRouter only). The warm-slot list
   excludes `ANTHROPIC_API_KEY` and `BBX_AGENT_TOKEN`; "injected" is not the
   same as "compared".
2. **P1. A live credential consumer is missing.** gws spreads `process.env`
   and injects `GOOGLE_WORKSPACE_CLI_TOKEN` (`connectors/gmail/gws.ts:104-108`).
   `claude auth login` and `logout` are not characterized either
   (`services/claude-cli.ts:98,154`).
3. **P1. The test stops before the process boundary.** A fake `spawn` skips
   `defaultSpawnChild`'s `extendEnv: false`; capturing Codex's `env: undefined`
   records an omitted option, not the child's environment.
4. **P1. Key names cannot prove an injected token replaced an ambient one.**
   Use distinct values; cover a status probe with no box root.
5. **P2. Chat start, prewarm, and pi's bash hook are not characterized.**
6. **P2. The name-pattern guard can be bypassed** by a credential named
   `SERVICE_AUTH`; require every allowlist name to be in the table or in an
   explicit non-credential set.

## Adjudication

1. Accepted in part. The Track 1 matrix has separate columns for the hub
   allowlist, the spawned hub child, and `box.env`, and one column per
   provider. The table keeps one `hubChild` column: `inject` there means
   `hubExtras`, and `box.env` takes only the `inherit` names, which is the
   current split. `claudeEngine` is defined as the most any provider adds; the
   matrix pins the per-provider detail. The warm slot compares `inject` cells
   only, which excludes `ANTHROPIC_API_KEY` (`blank`) and `BBX_AGENT_TOKEN`
   (not a `claudeEngine` injection) and reproduces
   `services/claude-chat/core.ts:172` exactly.
2. Accepted. gws (through a mocked `node:child_process`) and login/logout
   (through a recorder `claude` on `PATH`) are in the matrix. Their spreads
   stay; one issue is filed for them.
3. Accepted. The hub child runs through `defaultSpawnChild`, and Codex runs
   through the real Codex SDK with a recorder as `BBX_CODEX_BINARY`.
4. The test already compared values (ambient, injected, blank, absent); the
   plan text now says so. A no-box-root status probe column was added.
5. Rejected for this plan. The refactor does not edit those call sites, and
   the two functions they compose are pinned. Listed in NOT in scope.
6. Accepted in part. The pattern is wider (`PASS`, `AUTH`, `CREDENTIAL`,
   `PRIVATE`). A full enumeration was rejected: it is a second hand-kept copy
   of every allowlist, which is what the issue asks to remove.
