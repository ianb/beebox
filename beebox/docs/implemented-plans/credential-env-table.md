---
title: "One table of credential environment variables"
status: implemented
workstream: unattached
issues:
  - ../../../issues/closed/code-quality/2026-10-25-credential-env-keys-listed-in-several-allowlists.md
---
# One table of credential environment variables

Which process may see a credential environment variable is decided today in
four hand-written lists. This plan puts every credential name in one table that
states, for each process that gets a built environment, whether the variable
is inherited, injected, blanked, or denied, and derives the lists from it. A
characterization test fixes the current answers first, so the refactor cannot
change any process's environment.

**Issues addressed:**
`issues/closed/code-quality/2026-10-25-credential-env-keys-listed-in-several-allowlists.md`.
Related, closed: `issues/closed/bugs/2026-10-25-docker-oauth-token-env-never-reaches-agent.md`
(states the ambient `CLAUDE_CODE_OAUTH_TOKEN` exclusion as policy). Searched the
open queue for `allowlist`, `CLAUDE_CODE_OAUTH_TOKEN`, `child-env`, `script-env`:
no other open item.

## Design

No design section: an internal refactor of process environments; nothing a
person sees changes.

## Smallest fix and budget

Smallest fix: a comment block naming each credential and where it is excluded.
It does not stop the lists drifting, which is the issue.

Chosen: one module with the table plus three derivations, a characterization
test committed before the refactor, and one separate behavior fix (Track 3).
Estimate: table module about 120 lines; edits to the four list sites about 40
lines; characterization test about 250 lines; table guard tests about 60 lines;
Codex fix about 10 lines plus one changed test expectation. Total about 500
changed lines. No authored docs beyond comment updates.

## Stated preferences this plan trades against

- Root `AGENTS.md`: "Bias toward strict"; the brief: fail closed, every
  exclusion explicit. The table uses a `Record` over every consumer, so a row
  that omits a consumer does not compile.
- `src/hub/supervisor/child-env.ts:20`: *"Widen this list only by adding a new
  named entry with a reasoned comment -- never by reverting to a spread."* The
  table keeps a reason per row; allowlists stay allowlists.
- Memory "minimize invented concepts": no runtime registry, no new spawn helper.
  The table is data; the lists remain plain arrays built at module load.

## What already exists

- Hub child allowlist, `src/hub/supervisor/child-env.ts:42` `CHILD_ENV_ALLOWLIST`.
  Credentials in it today: `"BBX_DIAG_API_KEY"` (line 64), `"BBX_VAPID_PRIVATE_KEY"`,
  `"BBX_VAPID_PUBLIC_KEY"`. Reused; the credential entries move to the table.
- Hub injection, `src/hub/supervisor/child-spawn.ts:86-93`: `hubExtras` sets
  `BBX_HUB_SECRET: args.hubSecret`. Unchanged; the table records it as `inject`.
- `src/hub/box-env-file.ts:42` renders `/etc/beebox/box.env` through
  `buildChildEnv` minus `PER_BOX`; `PER_BOX` holds no credential. Inherits the
  derivation with no edit.
- Agent and tooling allowlists, `src/core/script-env/allowlist.ts:72`
  `SCRIPT_ENV_ALLOWLIST` and `:149` `CONNECTOR_ENV_ALLOWLIST`. No credential
  value is in either today. The exclusion rationale lives in the comment at
  `:27-61`; it moves into the table's per-row reasons.
- Agent token injection, `src/core/script-env/core.ts:161`:
  `out.BBX_AGENT_TOKEN = getOrCreateAgentToken(boxRoot);` Unchanged.
- Claude provider injection, `src/core/provider-env/core.ts:24`
  `providerEnvAdditions`: first-party adds `CLAUDE_CODE_OAUTH_TOKEN`
  (`core/claude-oauth-token.ts:40`); GLM adds `ANTHROPIC_BASE_URL`,
  `ANTHROPIC_AUTH_TOKEN` (`core/glm-key.ts:47-48`); OpenRouter adds those and
  `ANTHROPIC_API_KEY: ""` (`provider-env/openrouter-chat.ts:48-52`); `codex`
  and `pi` return null (`provider-env/core.ts:42-44`). Value-building code
  stays; the table names which credential keys it may emit, and a test checks
  that the emitted keys match.
- Warm-slot comparison, `src/services/claude-chat/core.ts:172`
  `PROVIDER_ENV_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN", "API_TIMEOUT_MS", "DISABLE_TELEMETRY", ...]`.
  The three credential names become a derivation; the four config names stay.
- Prompt logger, `src/core/agent/invoke/run.ts:236`, sets `ANTHROPIC_BASE_URL`
  outside `providerEnvAdditions`. Recorded in the table row's reason.
- Status probe, `src/services/claude-cli.ts:62-64`: `{ ...process.env }`,
  `delete env.CLAUDE_CODE_OAUTH_TOKEN`, then the box token. A spread, not an
  allowlist. Characterized; not changed (NOT in scope).
- Redaction set, `src/lib/env.ts:51` `SECRET_ENV_NAMES`. A test checks it is a
  subset of the table; it is not derived (NOT in scope).
- Existing tests: `test/hub/supervisor.test.ts`, `test/hub/box-env-file.test.ts`,
  `test/core/script-env.test.ts`, `test/core/claude-oauth-token.test.ts`,
  `test/core/agent/invoke/run.environment.test.ts`,
  `test/services/claude-chat.test.ts`. Reused unchanged except the one Codex
  expectation in Track 3.

## Prior art (external)

One external premise bears on Track 3: the Codex SDK's default environment.
`node_modules/@openai/codex-sdk/dist/index.js:249-256`: with no `env` option it
copies every `process.env` entry into the CLI's environment. Evaluated-only.

## Ontology

- **Credential variable** — an environment variable whose value grants access
  or spends money, or (for `ANTHROPIC_BASE_URL`) decides where a credential is
  sent. Identified by its exact name. Not a path to a credential store
  (`BBX_SECRETS_FILE`, `BBX_GOOGLE_TOKENS_FILE`, `BBX_AUTH_FILE`,
  `BBX_APNS_KEY_PATH`); those stay in the plain lists with their comments.
- **Consumer** — a process that receives an allowlisted environment built by
  beebox code: `hubChild` (`buildChildEnv`; `inject` means `hubExtras` at
  spawn, and `box.env` takes only the `inherit` names, minus `PER_BOX`),
  `agent` (`buildScriptEnv`, which the Claude, Codex and pi engines all start
  from), `tooling` (`buildToolingScriptEnv`), `claudeEngine` (the most that
  `providerEnvAdditions` or the prompt logger add on top of `agent` for some
  provider of a Claude CLI run; the per-provider detail stays in the provider
  code and in the Track 1 matrix). The hub process itself has no column: it
  runs with whatever environment the operator gives it.
- **Spread consumer** — a process started with `{ ...process.env }` or with no
  `env` option: the `claude auth` commands (`services/claude-cli.ts:62,98,154`)
  and gws (`connectors/gmail/gws.ts:107`). Not table columns: no list governs
  them. The table module's doc names them, and the Track 1 matrix pins what
  they see. Codex runs without `env` are one until Track 3.
- **Visibility** — one of `inherit` (copied from the parent's environment by
  the allowlist), `inject` (set by beebox code from a source it controls),
  `blank` (set to the empty string so the CLI cannot use an ambient copy),
  `deny` (never present). `claudeEngine` never uses `inherit`.
- Existing names reused: `CHILD_ENV_ALLOWLIST`, `SCRIPT_ENV_ALLOWLIST`,
  `CONNECTOR_ENV_ALLOWLIST`, `PROVIDER_ENV_KEYS`.

## Tracks / scope

### Track 1 — characterization test (committed first)

- What: one test that computes, from the current code, what every credential
  name (plus one unlisted sentinel name) looks like in every consumer, and
  checks it against a literal matrix. Each cell distinguishes inherited (the
  ambient value), injected (a value beebox set), blanked, and absent, so a
  test cannot pass when an ambient token replaces an injected one.
- Why: the brief requires that no consumer's effective environment changes.
  The test is the proof.
- Direction: `test/credential-visibility/every-consumer.test.ts`, a scenario
  group (the module under test does not exist yet, so the test cannot be named
  for it). It reads each environment at the real process boundary where one
  exists:
  - hub: `buildChildEnv`; a real child through `spawnBoxChild` and
    `defaultSpawnChild` (so `extendEnv: false` is exercised) that writes its
    own env; `renderBoxEnvFile`.
  - `buildScriptEnv`, `buildToolingScriptEnv`.
  - `providerEnvAdditions` for first-party (token granted), GLM, OpenRouter
    (model added, key granted), `codex`, `pi`.
  - a first-party Claude agent run (`runAgent`, SDK stream mocked) and scan
    vision (`runClaudeQuery` with a capturing `query`).
  - Codex agent runs with and without `env`, through the real Codex SDK with a
    recorder as `BBX_CODEX_BINARY`.
  - `claude auth status` with and without a box root, `auth login`,
    `auth logout`, through a recorder named `claude` first on `PATH`.
  - gws (`connectors/gmail/gws.ts:104-108`), with `node:child_process`
    mocked to capture the env.
  - warm slot: `warmCompatible` with two options differing in one name.
- First chunk: the test, passing on the current branch. No source change.

### Track 2 — the table and the derivations

- What: `src/lib/credential-env.ts` (layout-check decides the final directory:
  its users span `src/hub`, `src/core`, `src/services`) exports
  `CREDENTIAL_ENV: Readonly<Record<string, { visibility: Record<Consumer,
  Visibility>; why: string }>>`, `inheritedCredentials(consumer)`, and
  `injectedCredentials(consumer)`.
- Rows: `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_BASE_URL`, `BBX_SESSION_SECRET`, `BBX_HUB_SECRET`,
  `BBX_DIAG_API_KEY`, `BBX_BROWSE_API_KEY`, `BBX_AGENT_TOKEN`,
  `BBX_VAPID_PRIVATE_KEY`, `BBX_VAPID_PUBLIC_KEY`, `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_WORKSPACE_CLI_TOKEN`, and the retired connector names
  (`BBX_MISTRAL_API_KEY`, `BBX_DEEPGRAM_API_KEY`, `BBX_DEEPGRAM_PROJECT`,
  `BBX_OPENAI_API_KEY`, `THINKING_OPENAI_API_KEY`, `GEMINI_KEY`,
  `SKE_GEMINI_API_KEY`, `BBX_OPENROUTER_API_KEY`, `OPENAI_API_KEY`,
  `CODEX_API_KEY`), deny everywhere. Unlisted names are denied by the
  allowlists, as now.
- Derivations: `CHILD_ENV_ALLOWLIST = [...plain, ...inheritedCredentials("hubChild")]`;
  `SCRIPT_ENV_ALLOWLIST` and the tooling list likewise for `agent` and `tooling`;
  `PROVIDER_ENV_KEYS = [...injectedCredentials("claudeEngine"), ...config keys]`.
  The warm slot compares the `inject` cells only: an injected value can rotate
  between prewarm and send; `blank` (`ANTHROPIC_API_KEY`) is a constant, and
  `BBX_AGENT_TOKEN` is not a `claudeEngine` injection. This reproduces the
  current list exactly.
- Guards (test, `test/lib/credential-env.test.ts`): (1) every name in a
  composed allowlist that matches
  `/KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIAL|PRIVATE/` is a table row or
  in a named non-credential list in the test. A full enumeration of every
  allowlist name would be a second hand-kept copy of the lists, which is the
  problem this plan removes; the name check catches the usual names; (2) `SECRET_ENV_NAMES` is a
  subset of the table; (3) no `claudeEngine` cell is `inherit`.
- First chunk: the module, the four edits, the guard test. The Track 1 test
  passes unchanged.

### Track 3 — Codex runs without explicit additions get the full server env (separate commit)

- What: `src/core/agent/codex-run/core.ts:58-59` returns `undefined` when the
  caller passes no `env`, and the Codex SDK then copies all of `process.env`.
  A Codex job or procedure run so inherits `BBX_HUB_SECRET`, `BBX_DIAG_API_KEY`,
  `BBX_VAPID_PRIVATE_KEY`, and, outside the hub, `BBX_SESSION_SECRET` and any
  ambient `CLAUDE_CODE_OAUTH_TOKEN`. The Claude path always builds
  `buildScriptEnv` (`invoke/run.ts:233`); the Codex chat path does too
  (`chat/session/run/start.ts:148`).
- Why: the agent allowlist exists to withhold exactly these. The `undefined`
  branch dates from `5844a1024` ("Ordinary Codex calls keep their previous
  environment behavior"), a scope choice in an unrelated feature.
- Direction: always `buildScriptEnv(options.boxRoot, options.env)`. Update the
  one expectation in `run.environment.test.ts` and the Track 1 matrix row for
  the Codex default, in the same commit, flagged for the human.

## Could this be simpler?

The simplest version is the comment block (above). It fails the next time a
credential is added: nothing makes the author visit all four lists, which is
what review round 6 found. A test-only matrix with no table would catch a
changed list, but it would not say why any cell is what it is, and the lists
would still be maintained by hand. The table buys one place to edit and a
reason per cell. The plan adds no runtime check and no spawn helper.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A derivation drops or adds a name (wrong consumer key) | Track 1 matrix | — | Clear: matrix diff |
| A new credential is added to a plain list, not the table | Guard (1) | — | Clear: guard names it |
| Table row added with `inherit` for `agent` by mistake | Track 1 matrix (new row absent) | Code review | Silent until the matrix is extended; the matrix lists every row, and a test asserts the matrix covers every table row |
| Module-load order: table imported before init (circular import) | Typecheck and every consumer test | ES module order | Clear: throws at load |
| Codex fix: a Codex run needs an env var the allowlist drops | Chat Codex already runs on the same allowlist | — | Clear: Codex run fails |

## Agent-flow / user-flow edge cases

- Wrong field: no agent-facing vocabulary. ADDRESSED (none).
- Partial transition: one commit switches all four lists. ADDRESSED.
- Hand-edit drift: a developer edits a list directly. ADDRESSED by guard (1)
  and the matrix.
- Other cases (stale ref, two agents, fabricated value, validation UX): do not
  apply; nothing reads or writes cards.

## NOT in scope

- The status probe and `authLogin`/`authLogout` spread `process.env`
  (`services/claude-cli.ts:62,98,154`), and so does gws
  (`connectors/gmail/gws.ts:107`). They run a CLI, not agent code; converting
  them is a behavior change. Characterized in Track 1; file one issue.
- Chat start, prewarm, and pi's bash hook (`chat/session/run/start-run.ts:135`,
  `chat/session/registry/warm.ts:61`, `agent/pi-run/session/tools.ts:38`):
  they compose `buildScriptEnv` and `providerEnvAdditions`, which Track 1
  pins; this plan does not edit them.
- Deriving `SECRET_ENV_NAMES` from the table: its set would grow (redaction
  change). Guard (2) keeps them consistent instead.
- Credential-store paths (`BBX_SECRETS_FILE` etc.): their tooling-only rule is
  already explicit in `CONNECTOR_ENV_ALLOWLIST`.
- A spawn helper for processes started as another identity (issue's second
  direction): no such call site has a gap today beyond Track 3.
- Trick secrets (`cli/commands/trick.ts`): declared per trick under its own
  name, by design (`docs/security-report.md`, Credentials).

## Open design questions

none; Track 3's fix is flagged for the human, and can be reverted alone.

## Knowledge audits

Skip: no agent-facing concept; this is infrastructure.

## What will hold this after it ships

The Track 1 matrix (unit tier, fast) and the guard test. Both run in
change-selected tests for any edit to the table or a list site.

## Implementation notes

The cross-model diff review (codex gpt-6-astra) found a third leak: procedure
shell steps (`core/procedure/shell.ts`) passed the agent env to execa without
`extendEnv: false`, so execa merged `process.env` underneath. Pinned in the
matrix, then fixed in its own commit. The review's other new sites (view
metadata import, Codex CLI auth and plugin commands, the prompt logger,
Docling) are filed as issues. The matrix also now requires each injected value
to be the expected one, and checks the table against the observed cells.

## Implementation order

1. Track 1 test; commit.
2. Track 2 module, derivations, guard test; Track 1 test unchanged; commit.
3. Track 3 fix with its test changes; commit.
4. Close the issue; file the probe issue.

## Rollout shape

Done when: the Track 1 test passes unchanged after Track 2; guard tests pass;
`pnpm typecheck`, `pnpm layout-check`, and `pnpm test:changed` pass. No data
migration. The security report is drafted separately for the boxholder (the
skill forbids committing it unreviewed).
