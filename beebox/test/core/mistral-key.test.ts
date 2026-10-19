// # Mistral key resolution
//
// `src/core/mistral-key.ts` was the first consumer migrated onto the machine-level
// secret store and the template for the rest
// (`docs/implemented-plans/secret-custody.md`). The store is now the only source:
// the transition window that also read the in-tree
// `_config/connectors/mistral.secret.json` file and `BBX_MISTRAL_API_KEY` has
// closed. A box with no grant degrades to `null` — the caller's existing "not
// configured" path.
//
// Every key below is an obvious placeholder.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMistralApiKey } from "../../src/core/mistral-key.js";
import { grantSecret, revokeSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

// ## A grant is the only thing that resolves
//
// Neither of the retired sources produces a key. The env var and the stray file
// are both set here precisely to show they do nothing; only the grant does.
void test("Neither of the retired sources produces a key.", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_MISTRAL_API_KEY;
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L35
  const dir = await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  process.env.BBX_MISTRAL_API_KEY = "placeholder-env-key";
  await box.write("_config/connectors/mistral.secret.json", JSON.stringify({ apiKey: "placeholder-file-key" }));

  // doctest:L41
  t.check(await getMistralApiKey(box.root, { observe: true }), null);

  // doctest:L43
  await setSecret({ name: "mistral", value: "placeholder-store-key" });
  t.check(await getMistralApiKey(box.root, { observe: true }), null);

  // doctest:L46
  await grantSecret({ slug, name: "mistral", access: "server" });
  t.check(await getMistralApiKey(box.root, { observe: true }), "placeholder-store-key");

  // ## Revoking a grant actually stops the key
  //
  // This is what the fallbacks cost, and why they were removed on a deadline rather
  // than left indefinitely: with a file or env arm behind it, `revoke` on a box that
  // still had either would have been a no-op the boxholder could not see.

  // doctest:L61
  await revokeSecret({ slug, name: "mistral" });
  t.check(await getMistralApiKey(box.root, { observe: true }), null);

  // ## No box root is no answer
  //
  // Grants are per-box, so a caller without one — `TranscribeAudioParams.boxRoot`
  // is optional — has nothing to resolve against.

  // doctest:L72
  t.check(await getMistralApiKey(undefined, { observe: true }), null);
});
