/**
 * The box-subprocess env allowlist — the data half of `script-env.ts`, split
 * out so that file stays under the 300-line cap (the same split
 * `src/hub/child-env.ts` made out of `supervisor.ts`, for the same reason and
 * with the same fail-closed posture).
 */

/**
 * Env vars a box-spawned subprocess may inherit from the spawning server
 * process. Fail-closed ALLOWLIST, mirroring `src/hub/child-env.ts`'s
 * `CHILD_ENV_ALLOWLIST` one level down: the hub refuses to spread its env
 * into a box's `cb serve` child, and this refuses to spread that child's env
 * into the box's own agents, scripts, and tricks (Track 1 of
 * `docs/plans/secret-custody.md`).
 *
 * This used to be `{ ...process.env }` minus four names. A denylist only ever
 * withheld the secrets someone remembered to name — every connector credential
 * the server was configured with (`CALLBACK_MISTRAL_API_KEY`,
 * `CALLBACK_DEEPGRAM_*`, `GEMINI_KEY`, `SKE_GEMINI_API_KEY`,
 * `THINKING_OPENAI_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`, …) reached
 * every agent subprocess as inherited environment, which is strictly worse
 * than the on-disk secret files: the agent does not even have to open a file.
 * Widen this list only by adding a named entry with a reasoned comment — never
 * by reverting to a spread.
 *
 * The names deliberately NOT here, and why (the old strip-list's rationale,
 * now the exclusion rationale):
 *
 * - `ANTHROPIC_API_KEY` — the Claude Agent SDK and CLI both pick it up if
 *   present and silently bill it instead of the boxholder's subscription.
 *   Agents authenticate through `~/.claude/` (reached via `HOME` /
 *   `CLAUDE_CONFIG_DIR` below), never an API key.
 * - `CB_HUB_SECRET`, `CB_DIAG_API_KEY` — the hub's cross-box trust secrets. A
 *   `cb serve` child needs them to verify hub-proxied requests; an agent under
 *   that child must not inherit them, or it could forge
 *   `x-cb-hub-authenticated-email: <anyone>` (or `x-cb-hub-auth: off`) straight
 *   at a sibling box's loopback port and bypass identity + box ACLs, or forge
 *   the diagnostic bearer the same way. Agents authenticate to their OWN box
 *   via `CB_AGENT_TOKEN` (set below), never these.
 * - `CB_SESSION_SECRET` — the symmetric session-cookie signing key (verify ==
 *   forge, see `webapp/auth.ts`), so an agent holding it could mint a valid
 *   `cb_session` for ANY user on ANY box. (Partial, as ever: a same-user agent
 *   can still read the 0600 `~/.cb-session-secret` file — containment is
 *   Track 4's problem — but the trivial-inheritance path closes here.)
 * - `CB_BROWSE_API_KEY` — the browse-service bearer; same don't-inherit-power
 *   reason, and no box-spawned subprocess reads it.
 * - Every connector credential — see `CONNECTOR_ENV_ALLOWLIST` below: they are
 *   withheld from agents and reach only the `cb`-tooling spawn profile, until
 *   Track 3 retires the env-var credential path entirely.
 * - `CB_SERVER_URL` / `CB_BOX_NAME` — not inherited because they are always
 *   *derived* below from this box's own `publicUrl`; inheriting a parent's copy
 *   could point a subprocess at the wrong box.
 */
const SCRIPT_ENV_ALLOWLIST: readonly string[] = [
  // --- OS/runtime basics ---
  "PATH",
  "HOME",
  "USERPROFILE", // Windows HOME equivalent -- src/core/box.ts's homeDir fallback.
  "SHELL", // scheduled scripts' `runs:` commands execute through the shell (cli/commands/tick-helpers.ts).
  "TERM", // color/tty detection in spawned `cb` processes (src/lib/format.ts's chalk).
  "NO_COLOR", // src/lib/format.ts -- the standard color-suppression opt-out.
  "TMPDIR",
  "TEMP",
  "TMP",
  "USER", // git's author fallback in box commits, and ordinary tool expectations.
  "LOGNAME", // same, on systems that prefer it over USER.
  "NODE_ENV", // src/webapp/routes/api.ts, chat-audio-routes.ts: dev-only branches.
  "TZ",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",

  // --- Claude Agent SDK / codex config knobs (not credentials) ---
  "CLAUDE_CONFIG_DIR", // relocates the ~/.claude/ credentials dir the SDK reads.
  "CB_CLAUDE_PROJECTS_DIR", // src/core/chat/session/transcript-paths.ts, delete-storage.ts -- transcript-dir override doctests rely on.
  "CB_CODEX_BINARY", // src/services/codex-sdk-session.ts, codex-history-server.ts -- codex binary path override.
  "DISABLE_TELEMETRY",
  "DISABLE_ERROR_REPORTING",
  "DO_NOT_TRACK",

  // --- Box config a spawned `cb` process reads (paths and flags, not credentials) ---
  "PUBLIC_URL", // src/lib/public-url.ts, telegram-helpers.ts, and this file's publicUrl fallback.
  "CB_PUBLIC_URL", // src/lib/public-url.ts -- preferred over PUBLIC_URL when set.
  "CB_OWNER_EMAIL", // src/webapp/auth.ts getOwnerEmail() -- fleet owner identity, not a secret.
  "CB_AUTH_FILE", // src/webapp/local-users.ts -- credential-store PATH, not a credential; withholding it would point a test subprocess at the real global ~/.cb-auth.json.
  "CB_BOX_ROOT", // src/core/box/templates.ts -- the trick template's own box-root handle.
  "CB_HOOK_BIN", // src/core/install-validation-hooks.ts -- explicit hook-binary path override.
  "CB_INIT_CALLBACK_BOX_SPEC", // src/core/box/package.ts -- which callback-box spec `cb init` installs.
  "CB_SCAN_VISION", // src/services/scan-vision.ts -- photo-analysis backend selection.
  "CB_LOG_PROMPTS", // src/core/agent/run.ts -- prompt-logging debug flag.
  "TSX_TSCONFIG_PATH", // set by src/cli/bootstrap.ts; tricks spawn tsx directly (cli/commands/trick.ts) and need the same tsconfig.

  // --- Test/scenario harness (src/scenario/runner.ts sets these on process.env
  //     precisely so its spawned `cb wakeup`/`cb finalize` children inherit them) ---
  "CB_TIME", // src/cli/lib/time.ts, fetch.ts -- scenario/time-travel harness.
  "CB_SCENARIO_START_TIME", // src/cli/lib/fetch.ts -- scenario harness.
  "CB_STUBS_FILE", // src/cli/lib/fetch.ts -- scenario fixture path.
  "CB_STRICT_FETCH", // src/cli/bootstrap.ts -- scenario harness: fail on unstubbed fetch.
  "CB_AUTH_SCRYPT_N", // src/webapp/local-users-scrypt.ts -- test-only work-factor override.
  "CB_PUSH_FAKE", // src/core/send-push.ts -- push test harness.
  "CALLBACK_PUSH_STORE_DIR", // src/core/push-subscriptions.ts -- push-store path override for tests.
];

/**
 * Connector credentials, allowlisted ONLY for the `cb`-tooling spawn profile
 * (`buildToolingScriptEnv`) — never for an agent. A spawned `cb wakeup` runs
 * the connectors themselves (gmail/calendar/drive sync, preprocessing), and on
 * a server configured by env vars these are the only place those credentials
 * exist, so withholding them here would silently disable connector sync rather
 * than protect anything.
 *
 * Duplicated from `src/hub/child-env.ts`'s `CHILD_ENV_ALLOWLIST` rather than
 * shared: that list also carries names an agent-side spawn must never see
 * (`CB_DIAG_API_KEY`) and omits the harness/tooling names above, so one shared
 * constant would grow spurious entries on both sides. Keep the two in sync by
 * hand — Track 3 of `docs/plans/secret-custody.md` deletes both groups when
 * connector readers resolve from the secret store instead of env.
 */
const CONNECTOR_ENV_ALLOWLIST: readonly string[] = [
  "GOOGLE_OAUTH_CLIENT_ID", // src/connectors/google-auth.ts getGoogleClientCreds().
  "GOOGLE_OAUTH_CLIENT_SECRET", // ditto.
  "CB_GOOGLE_TOKENS_FILE", // src/connectors/google-token-store.ts -- a path, but to the OAuth token store.
  "CALLBACK_MISTRAL_API_KEY", // src/core/mistral-key.ts -- transcription key fallback.
  "THINKING_OPENAI_API_KEY", // src/core/transcription/index.ts -- transcription key.
  "CALLBACK_OPENAI_API_KEY", // src/core/search/embeddings-key.ts -- embeddings key.
  "GEMINI_KEY", // src/core/audio-question.ts, services/scan-vision.ts -- image/audio description key.
  "SKE_GEMINI_API_KEY", // same call sites -- documented fallback read alongside GEMINI_KEY.
];

/**
 * Connector credential PREFIXES for the tooling profile. `CALLBACK_DEEPGRAM_`
 * covers `CALLBACK_DEEPGRAM_API_KEY` + `CALLBACK_DEEPGRAM_PROJECT`
 * (src/core/deepgram-key.ts) — same category as the exact names above.
 */
const CONNECTOR_ENV_PREFIX_ALLOWLIST: readonly string[] = ["CALLBACK_DEEPGRAM_"];

/** Copy the allowed names/prefixes out of `sourceEnv` into a fresh env. */
function pickAllowed(
  sourceEnv: NodeJS.ProcessEnv,
  { names, prefixes }: { names: readonly string[]; prefixes: readonly string[] }
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of names) {
    const value = sourceEnv[key];
    if (value !== undefined) env[key] = value;
  }
  if (prefixes.length > 0) {
    for (const [key, value] of Object.entries(sourceEnv)) {
      if (value === undefined) continue;
      if (prefixes.some((prefix) => key.startsWith(prefix))) env[key] = value;
    }
  }
  return env;
}

/**
 * Build the inherited base env for a box-spawned subprocess: the allowlisted
 * names only. `connectorCreds` adds `CONNECTOR_ENV_ALLOWLIST` /
 * `CONNECTOR_ENV_PREFIX_ALLOWLIST` for the `cb`-tooling spawn profile — see
 * `buildToolingScriptEnv` in `script-env.ts`.
 */
export function pickBoxSubprocessEnv(
  sourceEnv: NodeJS.ProcessEnv,
  { connectorCreds }: { connectorCreds: boolean }
): NodeJS.ProcessEnv {
  return pickAllowed(sourceEnv, {
    names: connectorCreds
      ? [...SCRIPT_ENV_ALLOWLIST, ...CONNECTOR_ENV_ALLOWLIST]
      : SCRIPT_ENV_ALLOWLIST,
    prefixes: connectorCreds ? CONNECTOR_ENV_PREFIX_ALLOWLIST : [],
  });
}
