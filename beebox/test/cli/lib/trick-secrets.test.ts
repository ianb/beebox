// # Trick secret declarations

import { test } from "tap";
import "agent-doctest/tap";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { readTrickSecrets, resolveTrickSecret } from "../../../src/cli/lib/trick-secrets.js";

// ## Reads a declaration without running the trick
void test("Reads a declaration without running the trick", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L13
  const box = await makeTmpBox();
  const trickDir = box.path(join("src", "tricks", "scripts", "images"));
  await mkdir(trickDir, { recursive: true });
  await writeFile(join(trickDir, "secrets.json"), JSON.stringify([
    { name: "openai-images", reason: "image-generation", env: "OPENAI_API_KEY" },
  ]));
  const declarations = await readTrickSecrets(trickDir);
  t.check(declarations, [
    {
      name: "openai-images",
      reason: "image-generation",
      env: "OPENAI_API_KEY",
    },
  ]);
});

// ## Resolves through the derived child environment
void test("Resolves through the derived child environment", async (t) => {
  // doctest:L31
  const seen: { url: string; body: unknown; authorization: string | null }[] = [];
  const resolved = await resolveTrickSecret({
    env: { BBX_SERVER_URL: "http://localhost:3210", BBX_BOX_NAME: "test1", BBX_AGENT_TOKEN: "agent-token" },
    declaration: { name: "openai-images", reason: "image-generation", env: "OPENAI_API_KEY" },
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), body: init?.body, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ value: "secret-value", suspect: false }), { status: 200 });
    },
  });
  t.check(resolved, { value: "secret-value", suspect: false });
  t.check(seen, [{
    url: "http://localhost:3210/test1/api/secrets/resolve",
    body: '{"name":"openai-images","purpose":"image-generation"}',
    authorization: "Bearer agent-token",
  }]);
});

// ## Invalid declarations fail before execution
void test("Invalid declarations fail before execution", async (t) => {
  t.teardown(async () => {
    try {
      await invalidBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L61
  const invalidBox = await makeTmpBox();
  const invalidDir = invalidBox.path(join("src", "tricks", "scripts", "bad"));
  await mkdir(invalidDir, { recursive: true });
  await writeFile(join(invalidDir, "secrets.json"), "[{\"name\":\"x\",\"reason\":\"bad reason\",\"env\":\"PATH\"}]");
  await t.checkThrows(async () => (await readTrickSecrets(invalidDir)), "TrickSecretError");
});
