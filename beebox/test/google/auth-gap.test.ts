// # Why Google auth is unavailable, said out loud
//
// `getGoogleAuth` returns `null` for four unrelated situations, and every caller
// printed one sentence for all of them: *"Google auth not configured. Run: bbx
// google-auth." (the command has since been removed)*
//
// That sentence is wrong for three of the four, and it cost real work. On
// 2026-09-14 a boxholder reauthorized twice against a grant that was already
// healthy, because a box agent's shell could not see the token file and the only
// thing the system said was "not configured, run google-auth". Reauthorizing cannot
// fix a process looking in the wrong place — the message is what sent them there.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { explainGoogleAuthGap } from "../../src/google/auth-gap.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const tmp = await mkdtemp(path.join(os.tmpdir(), "google-auth-gap-"));

async function grantedBox() {
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  for (const name of ["google-oauth-client-id", "google-oauth-client-secret"]) {
    await setSecret({ name, value: `placeholder-${name}` });
    await grantSecret({ slug, name, access: "server" });
  }
  return box;
}

// ## No credential grant: the refusal explains itself
//
// `resolveSecret` returns typed refusals carrying, in its own words, "a message
// written for RELAY: the box agent reads it out to the boxholder".
// `getBoxGoogleClientCreds` dropped them. Now one reaches the surface.
void test("resolveSecret returns typed refusals carrying, in its own words, \"a message w...", async (t) => {
  const bare = await makeTmpBox();
  delete process.env.BBX_GOOGLE_TOKENS_FILE;
  const ungranted = await explainGoogleAuthGap(bare.root);
  t.checkText(
    ungranted,
    'Google auth unavailable: No secret named "google-oauth-client-id" exists on this machine. It can be declared (bbx secrets declare google-oauth-client-id), but only the boxholder can supply its value.',
  );

  await bare.cleanup();

  // ## The expensive case: credentials fine, no token file HERE
  //
  // The grant is healthy and the services authenticate; this process simply looks
  // somewhere else. The message has to say so, and has to say that authorizing again
  // will not help — that is the sentence that was missing.

  const box = await grantedBox();
  delete process.env.BBX_GOOGLE_TOKENS_FILE;
  const gap = await explainGoogleAuthGap(box.root);
  // It also never tells this caller to reconnect Google, which is the whole point.
  t.checkText(gap, `Google auth unavailable: no token file where this process looks — ${box.root}/_config/connectors/google.secret.json (BBX_GOOGLE_TOKENS_FILE is not set in this process). If the services authenticate fine, the grant is healthy and reauthorizing will not help: this process is looking somewhere else. Run it with the box service's environment.`);

  // ## A token file that exists but cannot be read is a different problem
  //
  // Present-but-unparseable is a machine problem, not a grant problem, so it does not
  // borrow either of the other two answers.

  process.env.BBX_GOOGLE_TOKENS_FILE = path.join(tmp, "broken-tokens.json");
  await writeFile(process.env.BBX_GOOGLE_TOKENS_FILE, "{ not json");
  const broken = await explainGoogleAuthGap(box.root);
  t.checkText(
    broken,
    `Google auth unavailable: a token file exists but could not be read — looked in ${path.join(tmp, "broken-tokens.json")} (from BBX_GOOGLE_TOKENS_FILE), or ${box.root}/_config/connectors/google.secret.json.`,
  );

  // ## Called without a box, it says that rather than guessing

  t.check(await explainGoogleAuthGap(undefined), "Google auth needs a box; this command ran without one.");

  await box.cleanup();
});
