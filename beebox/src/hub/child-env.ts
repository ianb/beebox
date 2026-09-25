/**
 * The hub-spawned box child's env allowlist (Track D, chunk D1 in
 * `docs/implemented-plans/boxes-as-packages-v2.md`), split out of `supervisor.ts` to
 * keep that file under the 300-line cap -- see `supervisor.ts`'s module doc
 * for how this fits into the supervisor's job.
 */

/**
 * Env vars a hub-spawned box child (`bbx serve`) may inherit from the hub's
 * own process env. Fail-closed ALLOWLIST, not a denylist -- `process.env`
 * on the hub process holds a hub-only credential, `BBX_SESSION_SECRET`, that
 * must NEVER reach a child: it's symmetric (HMAC), so any box that can
 * VERIFY a session cookie could also FORGE one for a sibling box. Spreading
 * `process.env` into every child (as this used to do) reopens exactly the
 * forgery hole Track D's D2 auth split closed (see
 * `docs/implemented-plans/boxes-as-packages-v2.md`'s "Isolation is layered": the hub is
 * trusted, boxes are not trusted with each other's secrets). Widen this
 * list only by adding a new named entry with a reasoned comment -- never by
 * reverting to a spread.
 *
 * Connector credentials are NOT listed. A box's connectors resolve them from
 * the machine secret store (`docs/implemented-plans/secret-custody.md`), so a
 * child inherits the store's PATH (`BBX_SECRETS_FILE`) and its grants decide
 * what it can read -- a much narrower thing to hand a child than the keys
 * themselves. `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` are out for a second reason
 * too: they configure the LOGIN surface, and a hub-spawned child is in hub
 * mode, where `/auth/*` is a 404 and login lives at the hub.
 *
 * Built from evidence: every `process.env.X` read under `src/webapp/`,
 * `src/core/`, and `src/connectors/` as of this writing (a hub-spawned
 * child only ever runs `bbx serve`, which is built from those trees), plus
 * the OS/runtime basics any Node process needs and the few Claude
 * Agent SDK knobs that are config, not secrets (subscription auth itself
 * reads `~/.claude/`, keyed off `HOME` below -- `ANTHROPIC_API_KEY` is
 * deliberately excluded, and is actively stripped elsewhere:
 * `cli/bootstrap.ts`, `core/script-env.ts`).
 */
const CHILD_ENV_ALLOWLIST: readonly string[] = [
  // --- OS/runtime basics ---
  "PATH",
  "HOME",
  "USERPROFILE", // Windows HOME equivalent -- src/core/box.ts's homeDir fallback.
  "TMPDIR",
  "TEMP",
  "TMP",
  "BBX_DEV_SURFACES", // Explicit local-only route/test-facility opt-in.
  "TZ",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",

  // --- Box-legitimate config/secrets a `bbx serve` child reads directly ---
  "PUBLIC_URL", // src/lib/public-url.ts, telegram-helpers.ts, script-env.ts fallback.
  "BBX_PUBLIC_URL", // src/lib/public-url.ts -- preferred over PUBLIC_URL when set.
  "BBX_OWNER_EMAIL", // src/webapp/auth.ts getOwnerEmail() -- fleet owner identity, not a secret.
  "BBX_AUTH_FILE", // src/webapp/local-users.ts + auth-capabilities.ts -- shared credential/capability store path, not a credential.
  "BBX_DIAG_API_KEY", // src/webapp/auth.ts verifyDiagBearerKey -- shared read-only diag bearer key.
  "BBX_GOOGLE_TOKENS_FILE", // src/connectors/google-auth.ts, requirements.ts -- a path, not a credential.
  "BBX_SECRETS_FILE", // src/core/secrets/store.ts -- the machine secret store's path, not a credential. A child that missed it would read the DEFAULT store while the hub read the override, so every grant would silently vanish for served boxes.
  "BBX_SECRETS_STORE_ISOLATED", // src/core/secrets/store.ts -- the dev router's assertion that BBX_SECRETS_FILE is a throwaway store; a child that missed it would refuse agent browsing on a Secrets panel the router meant to be drivable.
  "BBX_LOG_PROMPTS", // src/core/agent-run.ts -- debug flag.
  "BBX_STRICT_FETCH", // src/cli/bootstrap.ts -- test/scenario harness flag.
  "BBX_STUBS_FILE", // src/cli/lib/fetch.ts -- scenario fixture path.
  "BBX_SCENARIO_START_TIME", // src/cli/lib/fetch.ts -- scenario harness.
  "BBX_TIME", // src/cli/lib/time.ts, fetch.ts -- scenario/time-travel harness.
  "BBX_SCAN_VISION", // src/services/scan-vision.ts -- scan-import photo-analysis backend selection (claude default, gemini opt-in).

  // --- Claude Agent SDK config knobs (not credentials) ---
  "CLAUDE_CONFIG_DIR", // relocates the ~/.claude/ credentials dir the SDK reads.
  "DISABLE_TELEMETRY",
  "DISABLE_ERROR_REPORTING",
  "DO_NOT_TRACK",
];


/**
 * Build a hub-spawned child's env: only `CHILD_ENV_ALLOWLIST` entries from
 * `sourceEnv` (normally the hub's own `process.env`), plus `hubExtras`
 * (currently just `BBX_HUB_SECRET`)
 * layered on top. Pure and exported so it can be pinning-tested directly
 * without spawning anything real -- see `test/hub/supervisor.doctest.md`.
 */
export function buildChildEnv(params: {
  sourceEnv: NodeJS.ProcessEnv;
  hubExtras: Record<string, string>;
}): NodeJS.ProcessEnv {
  const { sourceEnv, hubExtras } = params;
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = sourceEnv[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...hubExtras };
}
