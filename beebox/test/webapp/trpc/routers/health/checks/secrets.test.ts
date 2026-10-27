// # The legacy-secret-files warning names the right action for each file
//
// An API-key file in `_config/connectors/` belongs in the machine store and is
// deleted after `bbx secrets migrate`. `google.secret.json` is different: it is
// the box's live OAuth grant, which the box rewrites and the store never holds
// (`src/core/secrets/migrate.ts` skips it), so deleting it would sign the box
// out of Google. On a unit host the warning says where it goes instead
// (`src/webapp/trpc/routers/health/checks/secrets.ts`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as path from "node:path";
import * as os from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { legacySecretFilesCheck } from "../../../../../../src/webapp/trpc/routers/health/checks/secrets.js";
import { makeTmpBox } from "../../../../../helpers/test-helpers.js";

void test("on a unit host, the Google token is moved and an API-key file is migrated", async (t) => {
  const saved = { home: process.env.HOME, unitHost: process.env.BBX_UNIT_HOST, tokens: process.env.BBX_GOOGLE_TOKENS_FILE };
  const box = await makeTmpBox();
  const home = await mkdtemp(path.join(os.tmpdir(), "legacy-secret-home-"));
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
  const connectors = path.join(box.root, "_config", "connectors");
  await mkdir(connectors, { recursive: true });
  await writeFile(path.join(connectors, "google.secret.json"), "{}");
  await writeFile(path.join(connectors, "openai.secret.json"), "{}");

  await t.check(legacySecretFilesCheck(box.root), {
    name: "legacy-secret-files",
    ok: false,
    message: "Legacy secret file — migrate to the machine store and delete: _config/connectors/openai.secret.json. "
      + `Google token in the box tree — copy _config/connectors/google.secret.json to ${home}/.config/beebox/google-tokens.json (as the box's user), then delete the in-tree file`,
    severity: "warning",
  });

  // Once a write has made the home file (seeded from the in-tree record), the
  // in-tree copy is only a stale duplicate.
  await mkdir(path.join(home, ".config", "beebox"), { recursive: true });
  await writeFile(path.join(home, ".config", "beebox", "google-tokens.json"), "{}");
  await t.check((await legacySecretFilesCheck(box.root)).message,
    "Legacy secret file — migrate to the machine store and delete: _config/connectors/openai.secret.json. "
      + `Google token copy in the box tree — ${home}/.config/beebox/google-tokens.json already holds the grant; delete _config/connectors/google.secret.json`);
});
