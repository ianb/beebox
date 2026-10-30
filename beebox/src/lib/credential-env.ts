/**
 * The credential environment variables, and which processes may see each.
 *
 * One row per credential name; every row states a visibility for every
 * consumer, so an exclusion is written down rather than implied by absence
 * from a list. The allowlists that build each consumer's environment take
 * their credential entries from here (`hub/supervisor/child-env.ts`,
 * `core/script-env/allowlist.ts`), and the warm-slot comparison takes its
 * credential keys from here (`services/claude-chat/core.ts`). Their other
 * entries are paths, flags and config, each listed there with its reason.
 *
 * Fail closed: a name in no row and no allowlist is inherited by nobody. To
 * let a consumer see a new credential, add a row here with a reason; never add
 * the name to a plain list.
 *
 * Consumers:
 *
 * - `hubChild` — the `bbx serve` child the hub spawns (`buildChildEnv`).
 *   `inject` means the hub sets it at spawn (`hubExtras`); the unit host's
 *   `/etc/beebox/box.env` (`hub/box-env-file.ts`) takes only the `inherit`
 *   names.
 * - `agent` — every box subprocess that runs agent-authored code:
 *   `buildScriptEnv`. The Claude, Codex and pi engines all start from it, and
 *   so does `bbx view check`'s render child. The view metadata import child
 *   takes this allowlist without the injected names (`agentAllowlistEnv`).
 * - `tooling` — the box's own `bbx` tooling: `buildToolingScriptEnv`.
 * - `claudeEngine` — what a Claude CLI run gets on top of `agent`: the most
 *   that `providerEnvAdditions` (`core/provider-env/core.ts`) or the prompt
 *   logger (`core/agent/invoke/run.ts`) adds for any provider. Never
 *   `inherit`. The warm slot compares the `inject` names, since an injected
 *   value can change between prewarm and send.
 *
 * The server moves the credentials it uses out of its own `process.env` at
 * startup (`lib/server-secrets.ts`), so a spread after that point omits them.
 *
 * Not governed here, because they spread `process.env` rather than take a
 * list: the `claude auth` commands (`services/claude-cli.ts`, which drops an
 * ambient `CLAUDE_CODE_OAUTH_TOKEN` from the status probe) and the gws
 * connector CLI (`connectors/gmail/gws.ts`).
 * `test/credential-visibility/every-consumer.test.ts` pins what every
 * consumer, these included, receives.
 */

/** A process that receives an allowlisted environment. */
export type CredentialConsumer = "hubChild" | "agent" | "tooling" | "claudeEngine";

/**
 * - `inherit`: copied from the parent's environment by the allowlist.
 * - `inject`: set by beebox code from a source it controls.
 * - `blank`: set to the empty string, so the process cannot use an ambient copy.
 * - `deny`: never present.
 */
export type CredentialVisibility = "inherit" | "inject" | "blank" | "deny";

interface CredentialRule {
  readonly visibility: Readonly<Record<CredentialConsumer, CredentialVisibility>>;
  readonly why: string;
}

const DENY_ALL = { hubChild: "deny", agent: "deny", tooling: "deny", claudeEngine: "deny" } as const;

/** Retired connector variables: their readers use the machine secret store now, so no process needs them. */
const RETIRED_CONNECTOR_KEY: CredentialRule = {
  visibility: DENY_ALL,
  why: "A retired connector env credential; connectors resolve keys from the machine secret store under the box's grants (docs/implemented-plans/secret-custody.md).",
};

export const CREDENTIAL_ENV: Readonly<Record<string, CredentialRule>> = {
  CLAUDE_CODE_OAUTH_TOKEN: {
    visibility: { ...DENY_ALL, claudeEngine: "inject" },
    why: "The box's long-lived Claude token is injected from the box's `claude-oauth-token` grant for first-party runs (core/claude-oauth-token.ts). An ambient copy in the hub's or server's env is never inherited: with one Linux user per box it would sign every box in as one account (issues/closed/bugs/2026-10-25-docker-oauth-token-env-never-reaches-agent.md).",
  },
  ANTHROPIC_API_KEY: {
    visibility: { ...DENY_ALL, claudeEngine: "blank" },
    why: "The SDK and CLI bill an API key instead of the subscription when one is present; stripped at startup (cli/entry/bootstrap.ts). OpenRouter runs set it blank so a real key is not sent as `x-api-key` (provider-env/openrouter-chat.ts).",
  },
  ANTHROPIC_AUTH_TOKEN: {
    visibility: { ...DENY_ALL, claudeEngine: "inject" },
    why: "The GLM or OpenRouter key, injected from the box's grant for a run on that provider only.",
  },
  ANTHROPIC_BASE_URL: {
    visibility: { ...DENY_ALL, claudeEngine: "inject" },
    why: "Decides where the CLI sends its credential: injected for GLM and OpenRouter runs and by the prompt logger; an inherited value could redirect a run's token.",
  },
  BBX_SESSION_SECRET: {
    visibility: DENY_ALL,
    why: "Hub only. Symmetric session-cookie key: a process that can verify a cookie can forge one for any user on any box (webapp/auth.ts). A same-user process can still read the 0600 `~/.bbx-session-secret` file; this closes only inheritance.",
  },
  BBX_HUB_SECRET: {
    visibility: { ...DENY_ALL, hubChild: "inject" },
    why: "Minted per hub boot and set on each spawned child so it can verify hub-proxied requests. An agent holding it could forge the hub's identity headers at a sibling box's port.",
  },
  BBX_DIAG_API_KEY: {
    visibility: { ...DENY_ALL, hubChild: "inherit" },
    why: "The shared read-only diagnostic bearer; a box server verifies it (webapp/auth.ts verifyDiagBearerKey). An agent holding it could call the diag surface of a sibling box.",
  },
  BBX_BROWSE_API_KEY: {
    visibility: DENY_ALL,
    why: "The dev browse-service bearer: full app access machine-wide. A dev box server verifies it in process (core/browse-key.ts); no box subprocess reads it.",
  },
  BBX_AGENT_TOKEN: {
    visibility: { ...DENY_ALL, agent: "inject", tooling: "inject" },
    why: "The box's own loopback token, injected from `.beebox/agent-token` so subprocess `bbx` calls pass its auth wall (core/agent/token.ts). Never inherited: a parent's copy may belong to another box.",
  },
  BBX_VAPID_PRIVATE_KEY: {
    visibility: { ...DENY_ALL, hubChild: "inherit" },
    why: "Box servers send web push (core/send-push.ts); without the key under the hub, web push cannot send. Agents send through their server.",
  },
  BBX_VAPID_PUBLIC_KEY: {
    visibility: { ...DENY_ALL, hubChild: "inherit" },
    why: "Paired with the private key for web push; listed here because lib/env.ts redacts it.",
  },
  GOOGLE_OAUTH_CLIENT_ID: {
    visibility: DENY_ALL,
    why: "Configures the login surface, which lives at the hub; a hub-mode child 404s `/auth/*`. Box connectors read their client from the secret store.",
  },
  GOOGLE_OAUTH_CLIENT_SECRET: {
    visibility: DENY_ALL,
    why: "As GOOGLE_OAUTH_CLIENT_ID.",
  },
  GOOGLE_WORKSPACE_CLI_TOKEN: {
    visibility: DENY_ALL,
    why: "A short-lived Google access token that connectors/gmail/gws.ts sets for the gws CLI only.",
  },
  BBX_MISTRAL_API_KEY: RETIRED_CONNECTOR_KEY,
  BBX_DEEPGRAM_API_KEY: RETIRED_CONNECTOR_KEY,
  BBX_DEEPGRAM_PROJECT: RETIRED_CONNECTOR_KEY,
  BBX_OPENAI_API_KEY: RETIRED_CONNECTOR_KEY,
  THINKING_OPENAI_API_KEY: RETIRED_CONNECTOR_KEY,
  GEMINI_KEY: RETIRED_CONNECTOR_KEY,
  SKE_GEMINI_API_KEY: RETIRED_CONNECTOR_KEY,
  BBX_OPENROUTER_API_KEY: {
    visibility: DENY_ALL,
    why: "A dev-only key source (dev/lib/openrouter-dev-key.ts); box runs use the `openrouter` grant.",
  },
  OPENAI_API_KEY: {
    visibility: DENY_ALL,
    why: "Codex signs in through the login under CODEX_HOME; no box process reads an OpenAI key from env.",
  },
  CODEX_API_KEY: {
    visibility: DENY_ALL,
    why: "The Codex SDK sets it only from an `apiKey` option, which beebox never passes; as OPENAI_API_KEY otherwise.",
  },
};

function namesWith(consumer: CredentialConsumer, visibility: CredentialVisibility): string[] {
  return Object.entries(CREDENTIAL_ENV).filter(([, rule]) => rule.visibility[consumer] === visibility).map(([name]) => name);
}

/** The credential names a consumer's allowlist copies from its parent. */
export function inheritedCredentials(consumer: CredentialConsumer): string[] {
  return namesWith(consumer, "inherit");
}

/** The credential names beebox code may set for a consumer from a source it controls. */
export function injectedCredentials(consumer: CredentialConsumer): string[] {
  return namesWith(consumer, "inject");
}
