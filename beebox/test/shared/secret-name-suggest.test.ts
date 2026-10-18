// # Near-miss secret names
//
// `suggestSecretName` (`src/shared/secret-name-suggest.ts`) catches typed secret
// names that are not exactly a registered name but resolve to nothing because
// they are close — case, punctuation — without ever using edit distance, which
// would also match `openai` to `openrouter`.

import { test } from "tap";
import "agent-doctest/tap";
import { normalizeSecretName, suggestSecretName } from "../../src/shared/secret-name-suggest.js";

const known = ["openrouter", "openai-thinking", "mistral", "bucket-token/"];

// ## Case and punctuation typos normalise to the registered name
void test("Case and punctuation typos normalise to the registered name", async (t) => {
  // doctest:L17
  t.check(suggestSecretName("OpenRouter", known), "openrouter");

  // doctest:L20
  t.check(suggestSecretName("open-router", known), "openrouter");
});

// ## An exact match never suggests
void test("An exact match never suggests", async (t) => {
  // doctest:L27
  t.check(suggestSecretName("openrouter", known), null);
});

// ## Whitespace-only difference never suggests
//
// Trimmed, `" openrouter "` is already the registered name exactly, so this
// counts as the exact-match case above rather than a near-miss.
void test("Trimmed, \" openrouter \" is already the registered name exactly, so this count...", async (t) => {
  // doctest:L37
  t.check(suggestSecretName(" openrouter ", known), null);
});

// ## A decorated name is still that name
//
// People guess `openrouter.ai` or `openrouter-key` for a thing called
// `openrouter`. A short list of the decorations actually appended — a domain
// suffix, or the word for the thing — is stripped once from the end, and only
// when what remains is a known name. It forgives a decoration; it never invents
// a match.
void test("People guess openrouter.ai or openrouter-key for a thing called openrouter.", async (t) => {
  // doctest:L50
  t.check([suggestSecretName("openrouter.ai", known), suggestSecretName("openrouter-key", known), suggestSecretName("OpenRouter API key", known)].join(","), "openrouter,openrouter,openrouter");
});

// A decoration with nothing known in front of it, or an unknown base, is not a
// near-miss of anything.
void test("A decoration with nothing known in front of it, or an unknown base, is not a...", async (t) => {
  // doctest:L58
  t.check(String(suggestSecretName("key", known)) + "," + String(suggestSecretName("weatherapi.com", known)), "null,null");
});

// ## No edit distance — `openai` is not a typo of `openrouter`
void test("No edit distance — `openai` is not a typo of `openrouter`", async (t) => {
  // doctest:L65
  t.check(suggestSecretName("openai", ["openrouter"]), null);
});

// ## Empty input never suggests
void test("Empty input never suggests", async (t) => {
  // doctest:L72
  t.check(suggestSecretName("", known), null);
});

// ## Family prefixes are ignored as match targets
//
// `bucket-token/` ends in `/` — nobody types that as a name.
void test("bucket-token/ ends in / — nobody types that as a name.", async (t) => {
  // doctest:L81
  t.check(suggestSecretName("buckettoken", known), null);
});

// ## `normalizeSecretName` strips everything but `[a-z0-9]` and case-folds
void test("`normalizeSecretName` strips everything but `[a-z0-9]` and case-folds", async (t) => {
  // doctest:L88
  t.check(normalizeSecretName(" open-router.ai "), "openrouterai");
});
