// # The secret guide registry: what a key is, and where to get one
//
// `src/core/secrets/guide-registry.ts` is the guidance layer secret custody named
// and left to agents at capture time — server-owned, like the probe registry, and
// keyed like every registry in `core/secrets/` (exact name or `family/` prefix).
// "What it is used for" is deliberately not a field: that comes from `uses.ts`.

import { test } from "tap";
import "agent-doctest/tap";
import { listSecretGuides, secretGuideFor, unguidedSecretNames } from "../../../src/core/secrets/guide-registry.js";
import { builtinSecretNames } from "../../../src/core/secrets/uses.js";

// ## Every name the engine has a use for has a guide
//
// This is the assertion that stops the two registries drifting: adding a consumer
// to `uses.ts` without writing its guide fails here, rather than leaving a name
// the add form cannot explain.
void test("This is the assertion that stops the two registries drifting:", async (t) => {
  // doctest:L20
  t.check(unguidedSecretNames(), []);

  // doctest:L23
  await t.checkText(listSecretGuides().length === builtinSecretNames().length, "true");
});

// ## A guide says what the credential is and where it comes from
void test("A guide says what the credential is and where it comes from", async (t) => {
  // doctest:L30
  const or = secretGuideFor("openrouter");
  t.check(or === null ? "none" : `${or.key} | ${or.guide.title} | ${or.guide.obtainUrl} | ${String(or.guide.obtainSteps.length)} steps`, "openrouter | OpenRouter API key | https://openrouter.ai/settings/keys | 4 steps");
});

// The last step of a pasteable key's guide is always the paste itself, because
// that is the moment the page is for.
void test("The last step of a pasteable key's guide is always the paste itself, because...", async (t) => {
  // doctest:L39
  const pasteable = listSecretGuides().filter(({ key }) => !key.endsWith("/"));
  await t.checkText(pasteable.every(({ guide }) => /paste/i.test(guide.obtainSteps.at(-1) ?? "")), "true");
});

// ## A name the engine does not know has no guide
//
// That is the honest answer for an ad-hoc secret — the form falls back to its
// plain fields rather than inventing guidance.
void test("That is the honest answer for an ad-hoc secret — the form falls back to its p...", async (t) => {
  // doctest:L50
  await t.checkText(String(secretGuideFor("weatherapi")), "null");
});
