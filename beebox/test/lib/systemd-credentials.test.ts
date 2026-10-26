// # systemd credentials become env vars
//
// A box unit passes the hub secret with `LoadCredential=hub-secret:...`;
// `adoptSystemdCredentials` turns the file under `$CREDENTIALS_DIRECTORY`
// into `BBX_HUB_SECRET` and does nothing outside systemd.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptSystemdCredentials } from "../../src/lib/systemd-credentials.js";

void test("the hub-secret credential fills BBX_HUB_SECRET and wins over an inherited value", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bbx-cred-"));
  await writeFile(join(dir, "hub-secret"), "s3cret\n");
  const env: NodeJS.ProcessEnv = { CREDENTIALS_DIRECTORY: dir, BBX_HUB_SECRET: "inherited" };
  t.check(adoptSystemdCredentials(env), ["BBX_HUB_SECRET"]);
  t.check(env, { CREDENTIALS_DIRECTORY: dir, BBX_HUB_SECRET: "s3cret" });
});

void test("no directory, or a directory without the credential, changes nothing", async (t) => {
  const plain: NodeJS.ProcessEnv = { BBX_HUB_SECRET: "x" };
  t.check(adoptSystemdCredentials(plain), []);
  t.check(plain, { BBX_HUB_SECRET: "x" });

  const empty = await mkdtemp(join(tmpdir(), "bbx-cred-"));
  const env: NodeJS.ProcessEnv = { CREDENTIALS_DIRECTORY: empty };
  t.check(adoptSystemdCredentials(env), []);
  t.check(env, { CREDENTIALS_DIRECTORY: empty });
});
