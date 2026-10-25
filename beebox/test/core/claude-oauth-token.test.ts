// # One long-lived Claude token signs a box's agent in
//
// A host with one Linux user per box cannot copy a login file to each user:
// the refresh token rotates and the copies revoke each other (production,
// 2026-10-25). `claude setup-token` mints a token that never refreshes; stored
// under `claude-oauth-token` and granted to the box, it reaches a first-party
// run's environment as `CLAUDE_CODE_OAUTH_TOKEN` and the `claude auth status`
// probe behind the preflight, readiness and health checks. Without the grant
// nothing changes. A GLM run authenticates with its own key and never gets it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerEnvAdditions } from "../../src/core/provider-env/core.js";
import { claudeOauthTokenEnv } from "../../src/core/claude-oauth-token.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { createClaudeCliService } from "../../src/services/claude-cli.js";
import { resolveProcedureModel } from "../../src/shared/agent-models.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const glm = resolveProcedureModel({ engine: "claude", model: "strong", provider: "glm" });

async function boxWith(config: Record<string, unknown>) {
  process.env.BBX_SECRETS_FILE = join(await mkdtemp(join(tmpdir(), "bbx-secrets-")), "secrets.json");
  const box = await makeTmpBox();
  await mkdir(join(box.root, "_config"), { recursive: true });
  await writeFile(join(box.root, "_config/box.json"), JSON.stringify(config));
  return box;
}

async function grantToken(boxRoot: string) {
  await setSecret({ name: "claude-oauth-token", value: "sk-ant-oat01-fixture-token-of-sufficient-length-00" });
  await grantSecret({ slug: await boxSlug(boxRoot), name: "claude-oauth-token", access: "server" });
}

// ## Without the grant, a first-party run is unchanged
void test("Without the grant, a first-party run is unchanged", async (t) => {
  const box = await boxWith({ claudeCodeTelemetry: "on" });
  t.teardown(() => box.cleanup());
  t.check(await claudeOauthTokenEnv(box.root, { purpose: "test", observe: false }), {});

  t.check(await providerEnvAdditions({ boxRoot: box.root, model: null, purpose: "test" }), null);
});

// ## With the grant, the token joins the first-party env, with the box's telemetry choice
void test("With the grant, the token joins the first-party env", async (t) => {
  const box = await boxWith({ claudeCodeTelemetry: "off" });
  t.teardown(() => box.cleanup());
  await grantToken(box.root);
  await setSecret({ name: "glm", value: "placeholder-glm-key-of-sufficient-length" });
  await grantSecret({ slug: await boxSlug(box.root), name: "glm", access: "server" });

  t.check(await providerEnvAdditions({ boxRoot: box.root, model: null, purpose: "test" }), {
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-fixture-token-of-sufficient-length-00",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
  });

  // A GLM run authenticates with its own key against Z.ai; the Claude token stays out.
  t.check(Object.keys((await providerEnvAdditions({ boxRoot: box.root, model: glm, purpose: "test" })) ?? {}).toSorted(), [
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "API_TIMEOUT_MS",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    "DISABLE_ERROR_REPORTING",
    "DISABLE_TELEMETRY",
  ]);
});

// ## The status probe runs with the box's token
//
// The real CLI, with an empty config dir so no login file answers: the probe
// reports the token (`oauth_token`) when the box is granted one, and no login
// otherwise. The CLI does not validate the token offline, so a fixture works.
void test("The status probe runs with the box's token", async (t) => {
  const box = await boxWith({});
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = await mkdtemp(join(tmpdir(), "bbx-claude-config-"));
  t.teardown(async () => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    await box.cleanup();
  });
  const pick = (status: Record<string, unknown>) => ({ loggedIn: status["loggedIn"], authMethod: status["authMethod"] });

  t.check(pick(await createClaudeCliService({ boxRoot: box.root }).authStatus()), { loggedIn: false, authMethod: "none" });

  await grantToken(box.root);
  t.check(pick(await createClaudeCliService({ boxRoot: box.root }).authStatus()), { loggedIn: true, authMethod: "oauth_token" });
});
