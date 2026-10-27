// # A sync that did nothing says which nothing it did
//
// A Google connector reaches two dead ends that are not sync failures: the box's
// own policy has the service switched off, or no credential this process can read.
// Both used to vanish. Gmail and Calendar returned a bare `{ success: true,
// created: [], updated: [] }`, and Drive returned a `success: false` — so a caller
// could not tell "nothing changed" from "nothing was attempted", and the three
// connectors disagreed about which it even was.
//
// `SyncResult.skipped` (`src/connector.ts`) carries the distinction:
// `not-allowed` for the policy switch, `not-configured` for the missing credential,
// each with a `detail` written for the box agent to relay to the boxholder.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGmailConnector } from "../../src/connectors/gmail/connector.js";
import { createGoogleCalendarConnector } from "../../src/connectors/google-calendar/connector.js";
import { createGoogleDriveConnector } from "../../src/connectors/google-drive/connector.js";
import { clearBoxConfigCache } from "../../src/core/box/config.js";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";

/** A sync that was not attempted: success, nothing created or updated, and why. */
function skipped(reason: "not-allowed" | "not-configured", detail: string) {
  return { success: true, created: [], updated: [], skipped: { reason, detail } };
}

const NO_CLIENT_ID = skipped(
  "not-configured",
  'Google auth unavailable: No secret named "google-oauth-client-id" exists on this machine. It can be declared (bbx secrets declare google-oauth-client-id), but only the boxholder can supply its value.',
);

/** Rewrite the box's Google policy and drop the mtime-keyed config cache. */
async function setPolicy(box: TmpBox, googleServices: Record<string, boolean>) {
  await box.write("_config/box.json", JSON.stringify({ googleServices }));
  clearBoxConfigCache(box.root);
}

// ## The policy switch: `not-allowed`
//
// A box with the service off has no credential problem at all, so the detail names
// the setting rather than sending anyone to reconnect Google. All three connectors
// answer the same way.
void test("A box with the service off has no credential problem at all, so the detail na...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await setPolicy(box, { gmail: false, calendar: false, drive: false });

  // The detail names the service that is off, so a boxholder reading it out of a
  // wakeup log knows which switch to flip.
  const off = (service: string) => skipped("not-allowed", `Enable it in box settings (\`googleServices.${service}\` in \`_config/box.json\`)`);
  t.check(await createGmailConnector(box.root).sync(), off("gmail"));
  t.check(await createGoogleCalendarConnector(box.root).sync(), off("calendar"));
  t.check(await createGoogleDriveConnector(box.root).sync(), off("drive"));


  // ## The missing credential: `not-configured`
  //
  // Turn the services on and there is still no OAuth grant this process can read.
  // The detail is `explainGoogleAuthGap`'s account of which piece is missing —
  // "reauthorize" is the right advice for only one of its four causes, and saying it
  // for the others is what cost a boxholder two pointless reauthorizations
  // (2026-09-14).
  //
  // Drive is the one that changed shape here: this was a `success: false` sync
  // error, which made it the only connector reporting a skip as a failure.

  process.env.BBX_SECRETS_FILE = join(await mkdtemp(join(tmpdir(), "bbx-secrets-")), "secrets.json");
  delete process.env.BBX_GOOGLE_TOKENS_FILE;
  await setPolicy(box, { gmail: true, calendar: true, drive: true });

  const gmail = await createGmailConnector(box.root).sync();
  const calendar = await createGoogleCalendarConnector(box.root).sync();
  const drive = await createGoogleDriveConnector(box.root).sync();

  // Every detail is a relay-ready sentence, not the old one-size "not configured".
  t.check(gmail, NO_CLIENT_ID);
  t.check(calendar, NO_CLIENT_ID);
  t.check(drive, NO_CLIENT_ID);
});
