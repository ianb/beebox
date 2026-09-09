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
 * into a box's `bbx serve` child, and this refuses to spread that child's env
 * into the box's own agents, scripts, and tricks (Track 1 of
 * `docs/implemented-plans/secret-custody.md`).
 *
 * This used to be `{ ...process.env }` minus four names. A denylist only ever
 * withheld the secrets someone remembered to name — every connector credential
 * the server was configured with (`BBX_MISTRAL_API_KEY`,
 * `BBX_DEEPGRAM_*`, `GEMINI_KEY`, `SKE_GEMINI_API_KEY`,
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
 * - `BBX_HUB_SECRET`, `BBX_DIAG_API_KEY` — the hub's cross-box trust secrets. A
 *   `bbx serve` child needs them to verify hub-proxied requests; an agent under
 *   that child must not inherit them, or it could forge
 *   `x-bbx-hub-authenticated-email: <anyone>` (or `x-bbx-hub-auth: off`) straight
 *   at a sibling box's loopback port and bypass identity + box ACLs, or forge
 *   the diagnostic bearer the same way. Agents authenticate to their OWN box
 *   via `BBX_AGENT_TOKEN` (set below), never these.
 * - `BBX_SESSION_SECRET` — the symmetric session-cookie signing key (verify ==
 *   forge, see `webapp/auth.ts`), so an agent holding it could mint a valid
 *   `bbx_session` for ANY user on ANY box. (Partial, as ever: a same-user agent
 *   can still read the 0600 `~/.bbx-session-secret` file — containment is
 *   Track 4's problem — but the trivial-inheritance path closes here.)
 * - `BBX_BROWSE_API_KEY` — the browse-service bearer; same don't-inherit-power
 *   reason, and no box-spawned subprocess reads it.
 * - Every connector credential — see `CONNECTOR_ENV_ALLOWLIST` below: they are
 *   withheld from agents and reach only the `bbx`-tooling spawn profile, until
 *   Track 3 retires the env-var credential path entirely.
 * - `BBX_SERVER_URL` / `BBX_BOX_NAME` — not inherited because they are always
 *   *derived* below from this box's own `publicUrl`; inheriting a parent's copy
 *   could point a subprocess at the wrong box.
 */
const SCRIPT_ENV_ALLOWLIST: readonly string[] = [
  // --- OS/runtime basics ---
  "PATH",
  "HOME",
  "USERPROFILE", // Windows HOME equivalent -- src/core/box.ts's homeDir fallback.
  "SHELL", // scheduled scripts' `runs:` commands execute through the shell (cli/commands/tick-helpers.ts).
  "TERM", // color/tty detection in spawned `bbx` processes (src/lib/format.ts's chalk).
  "NO_COLOR", // src/lib/format.ts -- the standard color-suppression opt-out.
  "TMPDIR",
  "TEMP",
  "TMP",
  "USER", // git's author fallback in box commits, and ordinary tool expectations.
  "LOGNAME", // same, on systems that prefer it over USER.
  "TZ",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",

  // --- Claude Agent SDK / codex config knobs (not credentials) ---
  "CLAUDE_CONFIG_DIR", // relocates the ~/.claude/ credentials dir the SDK reads.
  "BBX_CLAUDE_PROJECTS_DIR", // src/core/chat/session/transcript-paths.ts, delete-storage.ts -- transcript-dir override doctests rely on.
  "BBX_ORIGIN_ID_FILE", // src/core/chat/session/origin.ts -- machine-id file override doctests rely on.
  "BBX_CODEX_BINARY", // services/codex-sdk-session.ts and codex-binary.ts -- diagnostic binary override.
  "DISABLE_TELEMETRY",
  "DISABLE_ERROR_REPORTING",
  "DO_NOT_TRACK",

  // --- Box config a spawned `bbx` process reads (paths and flags, not credentials) ---
  "PUBLIC_URL", // src/lib/public-url.ts, telegram-helpers.ts, and this file's publicUrl fallback.
  "BBX_PUBLIC_URL", // src/lib/public-url.ts -- preferred over PUBLIC_URL when set.
  "BBX_OWNER_EMAIL", // src/webapp/auth.ts getOwnerEmail() -- fleet owner identity, not a secret.
  "BBX_AUTH_FILE", // src/webapp/local-users.ts -- credential-store PATH, not a credential; withholding it would point a test subprocess at the real global auth file.
  "BBX_BOX_ROOT", // src/core/box/templates.ts -- the trick template's own box-root handle.
  "BBX_HOOK_BIN", // src/core/install-validation-hooks.ts -- explicit hook-binary path override.
  "BBX_INIT_BEEBOX_SPEC", // src/core/box/package.ts -- which Bee Box spec `bbx init` installs.
  "BBX_SCAN_VISION", // src/services/scan-vision.ts -- photo-analysis backend selection.
  "BBX_LOG_PROMPTS", // src/core/agent/run.ts -- prompt-logging debug flag.
  "TSX_TSCONFIG_PATH", // set by src/cli/bootstrap.ts; tricks spawn tsx directly (cli/commands/trick.ts) and need the same tsconfig.

  // --- Test/scenario harness (src/scenario/runner.ts sets these on process.env
  //     precisely so its spawned `bbx wakeup`/`bbx finalize` children inherit them) ---
  "BBX_TIME", // src/cli/lib/time.ts, fetch.ts -- scenario/time-travel harness.
  "BBX_SCENARIO_START_TIME", // src/cli/lib/fetch.ts -- scenario harness.
  "BBX_STUBS_FILE", // src/cli/lib/fetch.ts -- scenario fixture path.
  "BBX_STRICT_FETCH", // src/cli/bootstrap.ts -- scenario harness: fail on unstubbed fetch.
  "BBX_AUTH_SCRYPT_N", // src/webapp/local-users-scrypt.ts -- test-only work-factor override.
  "BBX_PUSH_FAKE", // src/core/send-push.ts -- push test harness.
  "BBX_PUSH_STORE_DIR", // src/core/push-subscriptions.ts -- push-store path override for tests.
];

/**
 * Credential-store PATHS, allowlisted ONLY for the `bbx`-tooling spawn profile
 * (`buildToolingScriptEnv`) — never for an agent. A spawned `bbx wakeup` runs
 * the connectors themselves (gmail/calendar/drive sync, preprocessing), and
 * they resolve their credentials from the machine secret store, so what a
 * tooling child needs is the way to FIND the store, not the credentials.
 *
 * The connector credentials themselves used to be listed here too, which meant
 * an arbitrary `runs:` command inherited every connector key on the machine.
 * The secret-store transition closed that
 * (`docs/implemented-plans/secret-custody.md`): the readers no longer look at
 * env, so nothing is withheld by leaving the names out.
 *
 * `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` stay out for the same reason. They remain
 * live process configuration for the LOGIN surface
 * (`connectors/google-auth.ts`'s `getLoginGoogleClientCreds`), and a spawned
 * wakeup does not host login.
 */
const CONNECTOR_ENV_ALLOWLIST: readonly string[] = [
  "BBX_GOOGLE_TOKENS_FILE", // src/connectors/google-token-store.ts -- a path, but to the OAuth token store.
  "BBX_SECRETS_FILE", // src/core/secrets/store.ts -- the machine secret store's path. Tooling ONLY: a spawned `bbx wakeup` runs the connectors, which resolve their keys from the store. Deliberately absent from the agent profile -- an agent has no store interface yet, and pointing it at the file is the opposite of what the store is for.
];

/** Copy the allowed names out of `sourceEnv` into a fresh env. */
function pickAllowed(sourceEnv: NodeJS.ProcessEnv, names: readonly string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of names) {
    const value = sourceEnv[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Build the inherited base env for a box-spawned subprocess: the allowlisted
 * names only. `connectorCreds` adds `CONNECTOR_ENV_ALLOWLIST` for the
 * `bbx`-tooling spawn profile — see `buildToolingScriptEnv` in
 * `script-env.ts`.
 */
export function pickBoxSubprocessEnv(
  sourceEnv: NodeJS.ProcessEnv,
  { connectorCreds }: { connectorCreds: boolean }
): NodeJS.ProcessEnv {
  return pickAllowed(
    sourceEnv,
    connectorCreds ? [...SCRIPT_ENV_ALLOWLIST, ...CONNECTOR_ENV_ALLOWLIST] : SCRIPT_ENV_ALLOWLIST,
  );
}
