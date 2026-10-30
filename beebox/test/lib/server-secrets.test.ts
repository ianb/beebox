// # Server secrets leave the environment when the server starts
//
// Sealing is per process, so this file runs its tests in order: the live read
// comes first, and the sealed reads after it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { sealServerSecrets, serverSecret } from "../../src/lib/server-secrets.js";

void test("before sealing, a read is live from process.env", (t) => {
  t.teardown(() => { delete process.env.BBX_DIAG_API_KEY; });
  process.env.BBX_DIAG_API_KEY = "live";
  t.check(serverSecret("BBX_DIAG_API_KEY"), "live");
  t.end();
});

void test("sealing moves the secrets out of the environment and leaves other names", (t) => {
  const env: NodeJS.ProcessEnv = { BBX_HUB_SECRET: "hub", BBX_DIAG_API_KEY: "diag", PATH: "/bin" };
  sealServerSecrets(env);
  t.check(env, { PATH: "/bin" });
  t.check(serverSecret("BBX_HUB_SECRET"), "hub");
  t.check(serverSecret("BBX_DIAG_API_KEY"), "diag");
  t.end();
});

void test("after sealing, process.env cannot supply or replace a secret", (t) => {
  t.teardown(() => {
    delete process.env.BBX_HUB_SECRET;
    delete process.env.BBX_SESSION_SECRET;
  });
  process.env.BBX_HUB_SECRET = "planted";
  process.env.BBX_SESSION_SECRET = "planted";
  t.check(serverSecret("BBX_HUB_SECRET"), "hub");
  t.check(serverSecret("BBX_SESSION_SECRET"), undefined);
  t.end();
});
