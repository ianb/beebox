// # GLM key custody and env additions
//
// The GLM provider key lives in the machine secret store; runs on a `glm-*`
// model inject its endpoint and token into the child env. The env shape is
// pure, and the missing-key error names the two setup commands.

import { test } from "tap";
import "agent-doctest/tap";
import { glmEnvAdditions, GlmKeyError } from "../../src/core/glm-key.js";
import { UnknownSecretError } from "../../src/core/secrets/errors.js";

// ## Env additions
//
// One resolved key becomes exactly three variables — endpoint, token, and the
// long first-token timeout Z.ai needs.
void test("One resolved key becomes exactly three variables — endpoint, token, and the l...", async (t) => {
  // doctest:L18
  t.check(glmEnvAdditions("k-test"), {
    ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    ANTHROPIC_AUTH_TOKEN: "k-test",
    API_TIMEOUT_MS: "3000000",
  });
});

// ## Missing-key refusal
//
// A GLM run without a usable key refuses with the two setup commands — it must
// never fall back to first-party, which would switch providers mid-session.
void test("A GLM run without a usable key refuses with the two setup commands — it must...", async (t) => {
  // doctest:L28
  const error = new GlmKeyError(new UnknownSecretError("glm"));
  t.check(error.name, "GlmKeyError");

  // doctest:L32
  await t.checkText(
    // the error names both setup commands:
    error.message.includes("bbx secrets set glm") && error.message.includes("bbx secrets grant <box-slug> glm"),
    "true",
  );
});
