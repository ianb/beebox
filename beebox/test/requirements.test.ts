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
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMissingConnectors } from "../src/requirements.js";
import { declareSecret, grantSecret, revokeSecret, setSecret } from "../src/core/secrets/lifecycle.js";
import { boxSlug } from "../src/lib/box-slug.js";
import { secretsLogDir } from "../src/core/secrets/store.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

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
  return JSON.stringify(await checkMissingConnectors(boxRoot, { connectors }));
}

// ## A granted secret with a value configures the connector
void test("A granted secret with a value configures the connector", async (t) => {
  const out = printed();
  const print = out.print;
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
  print(`nothing configured: ${await missing(box.root, "raindrop")}`);
  await setSecret({ name: "raindrop", value: "placeholder-raindrop-key" });
  print(`stored but not granted: ${await missing(box.root, "raindrop")}`);
  await grantSecret({ slug, name: "raindrop", access: "server" });
  print(`granted: ${await missing(box.root, "raindrop")}`);
  await revokeSecret({ slug, name: "raindrop" });
  await t.checkText(out.with(print(`revoked again: ${await missing(box.root, "raindrop")}`)), `nothing configured: ["raindrop"]
stored but not granted: ["raindrop"]
granted: []
revoked again: ["raindrop"]`);

  // A granted-but-empty slot is a declared intention, not a configured connector —
  // the script would fail exactly as it does with no grant at all.

  // doctest:L77
  await declareSecret({ name: "someservice", note: "waiting on the boxholder" });
  await grantSecret({ slug, name: "someservice", access: "agent" });
  await t.checkText(out.with(print(`granted, no value yet: ${await missing(box.root, "someservice")}`)), "granted, no value yet: [\"someservice\"]");

  // ## A per-box instance of a name counts
  //
  // A requirement names the store entry itself or its per-box form
  // `<name>/<slug>`; either one, granted to this box and holding a value, is
  // configured.

  // doctest:L91
  await setSecret({ name: `otherservice/${slug}`, value: "placeholder-token" });
  print(`stored per-box, not granted: ${await missing(box.root, "otherservice")}`);
  await grantSecret({ slug, name: `otherservice/${slug}`, access: "server" });
  await t.checkText(out.with(print(`granted per-box: ${await missing(box.root, "otherservice")}`)), `stored per-box, not granted: ["otherservice"]
granted per-box: []`);

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
  print(`tokens + policy, no client grant: ${await missing(box.root, "gmail")}`);

  // doctest:L116
  for (const name of ["google-oauth-client-id", "google-oauth-client-secret"]) {
    await setSecret({ name, value: `placeholder-${name}` });
    await grantSecret({ slug, name, access: "server" });
  }
  print(`client credentials granted: ${await missing(box.root, "gmail")}`);

  // doctest:L122
  // The per-box policy still gates it independently.
  await box.write("_config/box.json", JSON.stringify({ googleServices: { gmail: false } }));
  await t.checkText(out.with(print(`policy disabled: ${await missing(box.root, "gmail")}`)), `tokens + policy, no client grant: ["gmail"]
client credentials granted: []
policy disabled: ["gmail"]`);

  // ## The check is not an access
  //
  // The scheduler asks this question on every tick, for every box. It used to
  // resolve both client-credential values to answer it, which wrote two access-log
  // lines each time — about 99% of the log. The check now reads grants only, so it
  // writes nothing: neither `resolve` lines where Google is configured nor
  // `unknown-secret` refusals where it is not.

  // doctest:L140
  await box.write("_config/box.json", JSON.stringify({ googleServices: { gmail: true } }));
  const before = (await logLines()).length;
  print(`configured: ${await missing(box.root, "gmail")}`);
  const other = await makeTmpBox();
  await other.write("_config/box.json", JSON.stringify({ googleServices: { gmail: true } }));
  print(`another box, no grant: ${await missing(other.root, "gmail")}`);
  await other.cleanup();
  await t.checkText(out.with(print(`log lines written by the checks: ${(await logLines()).length - before}`)), `configured: []
another box, no grant: ["gmail"]
log lines written by the checks: 0`);

  // ## A retired in-tree file does not satisfy it
  //
  // `bbx health` flags such a file separately; here it is simply not a credential.

  // doctest:L159
  await box.write("_config/connectors/pocket.secret.json", JSON.stringify({ apiKey: "placeholder-pocket-key" }));
  print(`stray file only: ${await missing(box.root, "pocket")}`);
  await t.checkText(out.with(print(`several at once: ${await missing(box.root, "pocket", "raindrop", "nothinghere")}`)), `stray file only: ["pocket"]
several at once: ["pocket","raindrop","nothinghere"]`);
});
