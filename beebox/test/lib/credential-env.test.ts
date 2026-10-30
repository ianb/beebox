// # The credential table is the only way a credential reaches an allowlist
//
// `lib/credential-env.ts` names every credential variable and says, per
// consumer, whether it is inherited, injected, blanked, or denied. The
// allowlists take their credential entries from it. These checks keep the
// lists and the table from drifting apart; what each process actually
// receives is pinned in `test/credential-visibility/every-consumer.test.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { CREDENTIAL_ENV, inheritedCredentials, type CredentialConsumer } from "../../src/lib/credential-env.js";
import { CHILD_ENV_ALLOWLIST } from "../../src/hub/supervisor/child-env.js";
import { SCRIPT_ENV_ALLOWLIST, TOOLING_ENV_ALLOWLIST } from "../../src/core/script-env/allowlist.js";
import { SECRET_ENV_NAMES } from "../../src/lib/env.js";

const LISTS: ReadonlyArray<[CredentialConsumer, readonly string[]]> = [
  ["hubChild", CHILD_ENV_ALLOWLIST],
  ["agent", SCRIPT_ENV_ALLOWLIST],
  ["tooling", TOOLING_ENV_ALLOWLIST],
];

/** A name that looks like it could hold a credential. */
const CREDENTIAL_LIKE = /KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIAL|PRIVATE/;

/**
 * Allowlisted names that match {@link CREDENTIAL_LIKE} but hold no credential.
 * Each is a path to a store, an identifier, or a test knob; its reason is next
 * to it in the allowlist.
 */
const NOT_CREDENTIALS = new Set([
  "BBX_AUTH_FILE",
  "BBX_AUTH_SCRYPT_N",
  "BBX_GOOGLE_TOKENS_FILE",
  "BBX_SECRETS_FILE",
  "BBX_SECRETS_STORE_ISOLATED",
  "BBX_APNS_KEY_PATH",
  "BBX_APNS_KEY_ID",
]);

// ## A credential-looking name in a list is a table row the list inherits
//
// Adding `SOME_API_KEY` to a plain list fails here: it has to become a row in
// the table, with a visibility for every consumer and a reason.
void test("A credential-looking name in a list is a table row the list inherits", async (t) => {
  const strays = LISTS.flatMap(([consumer, list]) => list
    .filter((name) => CREDENTIAL_LIKE.test(name) && !NOT_CREDENTIALS.has(name))
    .filter((name) => CREDENTIAL_ENV[name]?.visibility[consumer] !== "inherit")
    .map((name) => `${consumer}: ${name}`));
  t.check(strays, []);

  // And the credentials in each list are exactly the table's `inherit` cells.
  t.check(
    LISTS.map(([consumer, list]) => [consumer, list.filter((name) => name in CREDENTIAL_ENV).toSorted()]),
    LISTS.map(([consumer]) => [consumer, inheritedCredentials(consumer).toSorted()]),
  );
});

// ## No list names a variable twice
void test("No list names a variable twice", async (t) => {
  t.check(LISTS.map(([consumer, list]) => [consumer, list.length === new Set(list).size]), LISTS.map(([consumer]) => [consumer, true]));
});

// ## A Claude run never inherits a credential
//
// `claudeEngine` is what a Claude CLI run gets on top of the agent profile, all
// of it set by beebox code. Inheriting there would bypass the agent allowlist.
void test("A Claude run never inherits a credential", async (t) => {
  t.check(Object.entries(CREDENTIAL_ENV).filter(([, rule]) => rule.visibility.claudeEngine === "inherit").map(([name]) => name), []);
});

// ## Every name the startup validator redacts is in the table
void test("Every name the startup validator redacts is in the table", async (t) => {
  t.check([...SECRET_ENV_NAMES].filter((name) => !(name in CREDENTIAL_ENV)), []);
});

// ## The table's rows
//
// A new row also needs a line in the matrix of
// `test/credential-visibility/every-consumer.test.ts`, so the processes'
// actual environments are checked for it.
void test("The table's rows", async (t) => {
  t.check(Object.keys(CREDENTIAL_ENV), [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "BBX_SESSION_SECRET",
    "BBX_HUB_SECRET",
    "BBX_DIAG_API_KEY",
    "BBX_BROWSE_API_KEY",
    "BBX_AGENT_TOKEN",
    "BBX_VAPID_PRIVATE_KEY",
    "BBX_VAPID_PUBLIC_KEY",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_WORKSPACE_CLI_TOKEN",
    "BBX_MISTRAL_API_KEY",
    "BBX_DEEPGRAM_API_KEY",
    "BBX_DEEPGRAM_PROJECT",
    "BBX_OPENAI_API_KEY",
    "THINKING_OPENAI_API_KEY",
    "GEMINI_KEY",
    "SKE_GEMINI_API_KEY",
    "BBX_OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
  ]);
});
