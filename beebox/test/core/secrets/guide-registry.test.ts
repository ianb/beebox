// # The secret guide registry: what a key is, and where to get one
//
// `src/core/secrets/guide-registry.ts` is the guidance layer secret custody named
// and left to agents at capture time — server-owned, like the probe registry, and
// keyed like every registry in `core/secrets/` (exact name or `family/` prefix).
// "What it is used for" is deliberately not a field: that comes from `uses.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { listSecretGuides, secretGuideFor, unguidedSecretNames } from "../../../src/core/secrets/guide-registry.js";
import { builtinSecretNames } from "../../../src/core/secrets/uses.js";

// ## Every name the engine has a use for has a guide
//
// This is the assertion that stops the two registries drifting: adding a consumer
// to `uses.ts` without writing its guide fails here, rather than leaving a name
// the add form cannot explain.
void test("This is the assertion that stops the two registries drifting:", async (t) => {
  t.check(unguidedSecretNames(), []);

  t.check(listSecretGuides().map(({ key }) => key).toSorted(), builtinSecretNames().toSorted());
});

// ## A guide says what the credential is and where it comes from
void test("A guide says what the credential is and where it comes from", async (t) => {
  const or = secretGuideFor("openrouter");
  t.check(or, {
    key: "openrouter",
    guide: {
      title: "OpenRouter API key",
      what: "One account that fronts many model providers, billed together. A single OpenRouter key stands in for separate OpenAI, Google and Mistral keys for every service listed below — one key and one bill instead of four.",
      obtainUrl: "https://openrouter.ai/settings/keys",
      obtainSteps: [
        "Sign in at openrouter.ai and add a few dollars of credit — usage is pay-as-you-go and these services cost cents",
        "Open Settings → Keys and choose Create key; a name like \"bee box\" is enough, and a spending limit is optional",
        "Copy the key — it starts with sk-or-v1- and is shown once",
        "Paste it below",
      ],
    },
  });
});

// The last step of a pasteable key's guide is always the paste itself, because
// that is the moment the page is for.
void test("The last step of a pasteable key's guide is always the paste itself, because...", async (t) => {
  const pasteable = listSecretGuides().filter(({ key }) => !key.endsWith("/"));
  t.check(pasteable.map(({ guide }) => guide.obtainSteps.at(-1)), [
    "Paste it below",
    "Paste it below",
    "Paste it below",
    "Paste it below",
    "Paste it below",
    "Paste it below",
    "Paste it below",
    "Paste both below as JSON: {\"apiKey\": \"…\", \"projectId\": \"…\"}",
    "Paste it below",
    "Copy the token and paste it below",
    "Copy the client id — it ends in .apps.googleusercontent.com — and paste it below; add the client secret as its own entry",
    "Copy the client secret and paste it below",
  ]);
});

// ## A name the engine does not know has no guide
//
// That is the honest answer for an ad-hoc secret — the form falls back to its
// plain fields rather than inventing guidance.
void test("That is the honest answer for an ad-hoc secret — the form falls back to its p...", async (t) => {
  t.check(secretGuideFor("weatherapi"), null);
});
