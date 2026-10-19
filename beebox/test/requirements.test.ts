// # `<requires><connector>` counts a granted secret, not just a file
//
// A scheduled script can declare `<requires><connector>name</connector></requires>`
// and the scheduler skips it cleanly when the connector isn't configured
// (`src/requirements.ts`).
//
// That probe used to check one thing: does `_config/connectors/<name>.secret.json`
// exist? Credentials now live in the machine store
// (`docs/implemented-plans/secret-custody.md`), so the probe asks about a grant
// with a value instead. A leftover file is not an answer either way: nothing reads
// those files, so counting one would start a script that then fails for want of a
// credential.
//
// Placeholder values throughout.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMissingConnectors } from "../src/requirements.js";
import { declareSecret, grantSecret, revokeSecret, setSecret } from "../src/core/secrets/lifecycle.js";
import { boxSlug } from "../src/lib/box-slug.js";
import { secretsLogDir } from "../src/core/secrets/store.js";
import { makeTmpBox } from "./helpers/test-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

/** Every access-log line written so far, as `event secret` pairs. */
async function logLines() {
  const files = await readdir(secretsLogDir()).catch(() => []);
  const lines = [];
  for (const file of files) {
    const text = await readFile(join(secretsLogDir(), file), "utf-8");
    for (const line of text.trim().split("\n").filter(Boolean)) {
      const e = JSON.parse(line);
      lines.push(`${e.event} ${e.secret}`);
    }
  }
  return lines;
}

/** What the scheduler would report as missing. */
async function missing(boxRoot: string, ...connectors: string[]) {
  return checkMissingConnectors(boxRoot, { connectors });
}

// ## A granted secret with a value configures the connector
void test("A granted secret with a value configures the connector", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_GOOGLE_TOKENS_FILE;
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L55
  const dir = await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);

  // doctest:L59
  t.check(await missing(box.root, "raindrop"), ["raindrop"]);
  await setSecret({ name: "raindrop", value: "placeholder-raindrop-key" });
  t.check(await missing(box.root, "raindrop"), ["raindrop"]);
  await grantSecret({ slug, name: "raindrop", access: "server" });
  t.check(await missing(box.root, "raindrop"), []);
  await revokeSecret({ slug, name: "raindrop" });
  t.check(await missing(box.root, "raindrop"), ["raindrop"]);

  // A granted-but-empty slot is a declared intention, not a configured connector —
  // the script would fail exactly as it does with no grant at all.

  // doctest:L77
  await declareSecret({ name: "someservice", note: "waiting on the boxholder" });
  await grantSecret({ slug, name: "someservice", access: "agent" });
  t.check(await missing(box.root, "someservice"), ["someservice"]);

  // ## A per-box instance of a name counts
  //
  // A requirement names the store entry itself or its per-box form
  // `<name>/<slug>`; either one, granted to this box and holding a value, is
  // configured.

  // doctest:L91
  await setSecret({ name: `otherservice/${slug}`, value: "placeholder-token" });
  t.check(await missing(box.root, "otherservice"), ["otherservice"]);
  await grantSecret({ slug, name: `otherservice/${slug}`, access: "server" });
  t.check(await missing(box.root, "otherservice"), []);

  // ## Google needs the client-credential grant too, not just tokens
  //
  // Tokens plus an enabled policy used to be enough. They are not: without a grant
  // for the OAuth app's client credentials, `getGoogleAuth` returns null, so every
  // Google connector reports `skipped: not-configured` and syncs nothing. A script
  // that runs and does nothing is worse than one the scheduler skips before it
  // spends a run.

  // doctest:L109
  const tokensFile = join(dir, "google-tokens.json");
  await writeFile(tokensFile, JSON.stringify({ refreshToken: "placeholder-refresh" }));
  process.env.BBX_GOOGLE_TOKENS_FILE = tokensFile;
  await box.write("_config/box.json", JSON.stringify({ googleServices: { gmail: true } }));

  // doctest:L114
  t.check(await missing(box.root, "gmail"), ["gmail"]);

  // doctest:L116
  for (const name of ["google-oauth-client-id", "google-oauth-client-secret"]) {
    await setSecret({ name, value: `placeholder-${name}` });
    await grantSecret({ slug, name, access: "server" });
  }
  t.check(await missing(box.root, "gmail"), []);

  // doctest:L122
  // The per-box policy still gates it independently.
  await box.write("_config/box.json", JSON.stringify({ googleServices: { gmail: false } }));
  t.check(await missing(box.root, "gmail"), ["gmail"]);

  // ## The check is not an access
  //
  // The scheduler asks this question on every tick, for every box. It used to
  // resolve both client-credential values to answer it, which wrote two access-log
  // lines each time — about 99% of the log. The check now reads grants only, so it
  // writes nothing: neither `resolve` lines where Google is configured nor
  // `unknown-secret` refusals where it is not.

  // doctest:L140
  await box.write("_config/box.json", JSON.stringify({ googleServices: { gmail: true } }));
  const before = await logLines();
  t.check(await missing(box.root, "gmail"), []);
  const other = await makeTmpBox();
  await other.write("_config/box.json", JSON.stringify({ googleServices: { gmail: true } }));
  t.check(await missing(other.root, "gmail"), ["gmail"]);
  await other.cleanup();
  t.check(await logLines(), before);

  // ## A retired in-tree file does not satisfy it
  //
  // `bbx health` flags such a file separately; here it is simply not a credential.

  // doctest:L159
  await box.write("_config/connectors/pocket.secret.json", JSON.stringify({ apiKey: "placeholder-pocket-key" }));
  t.check(await missing(box.root, "pocket"), ["pocket"]);
  t.check(await missing(box.root, "pocket", "raindrop", "nothinghere"), ["pocket", "raindrop", "nothinghere"]);
});
