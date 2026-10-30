// # On a unit host, a box's Google token lives in the box user's home
//
// Each server box is its own Linux user, and the hub leaves
// `BBX_GOOGLE_TOKENS_FILE` out of `/etc/beebox/box.env`, so the hub's own file
// never reaches a box. The token then belongs beside the box user's secret
// store, `~/.config/beebox/google-tokens.json` (`src/google/token-store.ts`),
// outside the box tree the agent works in. Before this rule the OAuth callback,
// which saved with no box root, had nowhere to write a fresh grant.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import * as os from "node:os";
import * as path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { legacySecretPath, loadGoogleTokens, saveGoogleTokens } from "../../src/google/token-store.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

void test("a unit-host box saves and reads its Google token in its own home", async (t) => {
  const saved = { home: process.env.HOME, unitHost: process.env.BBX_UNIT_HOST, tokens: process.env.BBX_GOOGLE_TOKENS_FILE };
  const home = await mkdtemp(path.join(os.tmpdir(), "google-token-home-"));
  const box = await makeTmpBox();
  t.teardown(async () => {
    for (const [name, value] of [["HOME", saved.home], ["BBX_UNIT_HOST", saved.unitHost], ["BBX_GOOGLE_TOKENS_FILE", saved.tokens]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await box.cleanup();
    await rm(home, { recursive: true, force: true });
  });
  process.env.HOME = home;
  process.env.BBX_UNIT_HOST = "1";
  delete process.env.BBX_GOOGLE_TOKENS_FILE;

  // A box migrated before the move still has only the in-tree file; it keeps working.
  await mkdir(path.dirname(legacySecretPath(box.root)), { recursive: true });
  await writeFile(legacySecretPath(box.root), JSON.stringify({ refreshToken: "old-refresh" }));
  await t.check(loadGoogleTokens(box.root), { refreshToken: "old-refresh" });

  // A refresh carries only an access token. Its first write to the home file
  // starts from the in-tree record, so the home file, which wins from then on,
  // still holds the refresh token.
  await saveGoogleTokens({ accessToken: "fresh-access" }, { boxRoot: box.root });
  const homeFile = path.join(home, ".config", "beebox", "google-tokens.json");
  t.check(JSON.parse(await readFile(homeFile, "utf-8")), { refreshToken: "old-refresh", accessToken: "fresh-access", authCheckedAt: isoDate() });

  // A new grant from the OAuth callback lands in the home file too.
  await saveGoogleTokens({ refreshToken: "new-refresh" }, { boxRoot: box.root });
  await t.check(loadGoogleTokens(box.root), { refreshToken: "new-refresh", accessToken: "fresh-access", authCheckedAt: isoDate() });
});
