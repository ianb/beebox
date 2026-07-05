/**
 * The hub-spawned box child's env allowlist (Track D, chunk D1 in
 * `docs/implemented-plans/boxes-as-packages-v2.md`), split out of `supervisor.ts` to
 * keep that file under the 300-line cap -- see `supervisor.ts`'s module doc
 * for how this fits into the supervisor's job.
 */

/**
 * Env vars a hub-spawned box child (`cb serve`) may inherit from the hub's
 * own process env. Fail-closed ALLOWLIST, not a denylist -- `process.env`
 * on the hub process holds a hub-only credential, `CB_SESSION_SECRET`, that
 * must NEVER reach a child: it's symmetric (HMAC), so any box that can
 * VERIFY a session cookie could also FORGE one for a sibling box. Spreading
 * `process.env` into every child (as this used to do) reopens exactly the
 * forgery hole Track D's D2 auth split closed (see
 * `docs/implemented-plans/boxes-as-packages-v2.md`'s "Isolation is layered": the hub is
 * trusted, boxes are not trusted with each other's secrets). Widen this
 * list only by adding a new named entry with a reasoned comment -- never by
 * reverting to a spread.
 *
 * `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` are listed below
 * deliberately, not withheld like the session secret: they're the app's
 * connector identity (registered with Google), not a per-box or per-hub
 * secret, and every box's calendar/gmail/drive connectors read them
 * directly (`getGoogleClientCreds()` in `src/connectors/google-auth.ts`) to
 * run and refresh their own per-box tokens. Under the current architecture
 * connector OAuth stays per-box -- the box owns its tokens -- so the client
 * creds are shared on purpose. Splitting them so each box holds distinct
 * client creds (or a hub-mediated OAuth proxy) is the OS-user hardening
 * subplan's concern (`docs/unimplemented-plans/box-user-account-spec.md`),
 * not this allowlist's.
 *
 * Built from evidence: every `process.env.X` read under `src/webapp/`,
 * `src/core/`, and `src/connectors/` as of this writing (a hub-spawned
 * child only ever runs `cb serve`, which is built from those trees), plus
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
  "NODE_ENV", // src/webapp/routes/api.ts, chat-audio-routes.ts: dev-only branches.
  "TZ",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",

  // --- Box-legitimate config/secrets a `cb serve` child reads directly ---
  "PUBLIC_URL", // src/lib/public-url.ts, telegram-helpers.ts, script-env.ts fallback.
  "CB_PUBLIC_URL", // src/lib/public-url.ts -- preferred over PUBLIC_URL when set.
  "CB_OWNER_EMAIL", // src/webapp/auth.ts getOwnerEmail() -- fleet owner identity, not a secret.
  "CB_DIAG_API_KEY", // src/webapp/auth.ts verifyDiagBearerKey -- shared read-only diag bearer key.
  "CB_GOOGLE_TOKENS_FILE", // src/connectors/google-auth.ts, requirements.ts -- a path, not a credential.
  "GOOGLE_OAUTH_CLIENT_ID", // src/connectors/google-auth.ts getGoogleClientCreds() -- app identity, shared per-box by design (see block comment above).
  "GOOGLE_OAUTH_CLIENT_SECRET", // ditto -- connector OAuth stays per-box; the box owns its tokens.
  "CB_LOG_PROMPTS", // src/core/agent-run.ts -- debug flag.
  "CB_STRICT_FETCH", // src/cli/bootstrap.ts -- test/scenario harness flag.
  "CB_STUBS_FILE", // src/cli/lib/fetch.ts -- scenario fixture path.
  "CB_SCENARIO_START_TIME", // src/cli/lib/fetch.ts -- scenario harness.
  "CB_TIME", // src/cli/lib/time.ts, fetch.ts -- scenario/time-travel harness.
  "THINKING_OPENAI_API_KEY", // src/webapp/routes/chat-audio-routes.ts -- box's own transcription key.
  "CALLBACK_MISTRAL_API_KEY", // src/core/mistral-key.ts -- box's own transcription key fallback.
  "GEMINI_KEY", // src/core/audio-question.ts, commands/scan-import.ts, describe-images.ts, chat-audio.ts, webapp/trpc/routers/health.ts -- box's own image/audio description key.
  "SKE_GEMINI_API_KEY", // same call sites as GEMINI_KEY -- documented fallback read alongside it (checked first in src/core/audio-question.ts etc.).

  // --- Claude Agent SDK config knobs (not credentials) ---
  "CLAUDE_CONFIG_DIR", // relocates the ~/.claude/ credentials dir the SDK reads.
  "DISABLE_TELEMETRY",
  "DISABLE_ERROR_REPORTING",
  "DO_NOT_TRACK",
];

/**
 * Env var PREFIXES a hub-spawned box child may inherit -- for families with
 * more than one suffix, so adding a suffix later doesn't require touching
 * this file again. `CALLBACK_DEEPGRAM_` covers `CALLBACK_DEEPGRAM_API_KEY`
 * + `CALLBACK_DEEPGRAM_PROJECT` (src/core/deepgram-key.ts), the box's own
 * transcription credential fallback when no `config/connectors/deepgram.secret.json`
 * exists -- same "box-legitimate config a `cb serve` child reads directly"
 * category as the exact-name entries above.
 */
const CHILD_ENV_PREFIX_ALLOWLIST: readonly string[] = ["CALLBACK_DEEPGRAM_"];

/**
 * Build a hub-spawned child's env: only `CHILD_ENV_ALLOWLIST`/
 * `CHILD_ENV_PREFIX_ALLOWLIST` entries from `sourceEnv` (normally the hub's
 * own `process.env`), plus `hubExtras` (currently just `CB_HUB_SECRET`)
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
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined) continue;
    if (CHILD_ENV_PREFIX_ALLOWLIST.some((prefix) => key.startsWith(prefix))) {
      env[key] = value;
    }
  }
  return { ...env, ...hubExtras };
}
