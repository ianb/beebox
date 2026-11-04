---
title: "The `claude auth` commands and the gws CLI start with the server's whole environment"
workstream: unattached
area: beebox
labels: [security, env]
filed-by: agent
discovered-by: agent
discovered-in: worktree-agent-a80db54b588f8698c — characterizing credential visibility for the credential table
---

Four spawn sites copy all of `process.env` into a CLI instead of building an
allowlisted environment, so the server's credentials and every unlisted
variable reach the child (the exceptions are named per site):

- `src/services/claude-cli.ts` `authStatus`: `{ ...process.env }`, minus an
  ambient `CLAUDE_CODE_OAUTH_TOKEN`, plus the box's token.
- `authLogin`: `{ ...process.env, BROWSER: "echo" }`.
- `authLogout`: no `env` option, so Node passes `process.env`.
- `src/connectors/gmail/gws.ts` `runReadOnlyGws`:
  `{ ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: token }`. gws is a
  third-party npm CLI.

The cross-model review of the same change (codex gpt-6-astra) found more sites
with no `env` option, not yet in the matrix: Codex status and logout
(`src/services/codex-cli/core.ts`), Codex login
(`src/services/codex-cli/auth-app-server.ts`), plugin commands
(`src/core/agent/ensure-codex-plugin.ts`), the history server
(`src/services/codex-history-server.ts`), the prompt logger
(`src/core/agent/invoke/prompt-logger.ts`), and Docling
(`src/services/docling/core.ts`).

Under the hub that is `BBX_HUB_SECRET`, `BBX_DIAG_API_KEY`, and
`BBX_VAPID_PRIVATE_KEY`; outside it, also `BBX_SESSION_SECRET`. None of these
processes runs agent-authored code, so this is a defense-in-depth gap, not an
agent escape. `test/credential-visibility/every-consumer.test.ts` pins what each
receives today (the `status`, `statusNoBox`, `login`, `logout`, and `gws`
columns).

The status probe's stated purpose is to answer for the credential an agent run
uses (`core/claude-oauth-token.ts`); an agent run gets the `agent` allowlist
(`core/script-env/allowlist.ts`), so the probe would be more faithful on the
same list. Direction: build these envs from the agent allowlist (the claude
commands) or the tooling allowlist (gws) plus the one injected value, add
`claudeAuth` and `gws` consumers to `src/lib/credential-env.ts`, and update
the matrix. Check on macOS that `claude auth status` still finds the keychain
login (it needs `USER`, which the allowlist has).

Re-reviewed 2026-10-30: since the server now seals its own secrets out of process.env at startup, the named BBX_* secrets no longer reach these children in a running server; provider API keys and unlisted variables still do. The matrix test shows I for all because it runs without sealing.

Out of date in the body above: Replace the 'Under the hub that is BBX_HUB_SECRET, BBX_DIAG_API_KEY, and BBX_VAPID_PRIVATE_KEY' paragraph: after sealServerSecrets (src/lib/server-secrets.ts) those names are gone from process.env; what still leaks is provider keys (ANTHROPIC_API_KEY, OPENAI keys, BBX_MISTRAL/DEEPGRAM/OPENROUTER, GEMINI) and any unlisted variable, per the I cells in every-consumer.test.ts.
