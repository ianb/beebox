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
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGmailConnector } from "../../src/connectors/gmail/connector.js";
import { createGoogleCalendarConnector } from "../../src/connectors/google-calendar/connector.js";
import { createGoogleDriveConnector } from "../../src/connectors/google-drive/connector.js";
import { clearBoxConfigCache } from "../../src/core/box/config.js";
import { makeTmpBox, type TmpBox } from "../helpers/doctest-helpers.js";
import type { SyncResult } from "../../src/connector.js";

/** One line per connector: success, then how it skipped. */
function describe(name: string, result: SyncResult) {
  const skip = result.skipped
    ? `${result.skipped.reason}: ${result.skipped.detail.slice(0, 40)}`
    : "(not skipped)";
  return `${name}: success=${result.success} created=${result.created.length} ${skip}`;
}

/** Rewrite the box's Google policy and drop the mtime-keyed config cache. */
async function setPolicy(box: TmpBox, googleServices: Record<string, boolean>) {
  await box.write("_config/box.json", JSON.stringify({ googleServices }));
  clearBoxConfigCache(box.root);
}

// ## The policy switch: `not-allowed`
//
// A box with the service off has no credential problem at all, so the detail names
// the setting rather than sending anyone to `bbx google-auth`. All three connectors
// answer the same way.
void test("A box with the service off has no credential problem at all, so the detail na...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L47
  const box = await makeTmpBox();
  await setPolicy(box, { gmail: false, calendar: false, drive: false });

  // doctest:L50
  print(describe("gmail", await createGmailConnector(box.root).sync()));
  print(describe("calendar", await createGoogleCalendarConnector(box.root).sync()));
  await t.checkText(out.with(print(describe("drive", await createGoogleDriveConnector(box.root).sync()))), `gmail: success=true created=0 not-allowed: Enable it in box settings (\`googleServic
calendar: success=true created=0 not-allowed: Enable it in box settings (\`googleServic
drive: success=true created=0 not-allowed: Enable it in box settings (\`googleServic`);

  // The detail names the service that is off, so a boxholder reading it out of a
  // wakeup log knows which switch to flip:

  // doctest:L63
  const off = await createGoogleDriveConnector(box.root).sync();
  await t.checkText(out.with(off.skipped?.detail), "Enable it in box settings (`googleServices.drive` in `_config/box.json`)");

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

  // doctest:L80
  process.env.BBX_SECRETS_FILE = join(await mkdtemp(join(tmpdir(), "bbx-secrets-")), "secrets.json");
  delete process.env.BBX_GOOGLE_TOKENS_FILE;
  await setPolicy(box, { gmail: true, calendar: true, drive: true });

  // doctest:L84
  const gmail = await createGmailConnector(box.root).sync();
  const calendar = await createGoogleCalendarConnector(box.root).sync();
  const drive = await createGoogleDriveConnector(box.root).sync();

  // doctest:L88
  await t.checkText(out.with([gmail, calendar, drive].map((r) => `${r.success}/${r.skipped?.reason}`).join(" ")), "true/not-configured true/not-configured true/not-configured");

  // Every detail is a relay-ready sentence, not the old one-size "not configured":

  // doctest:L95
  await t.checkText(out.with(drive.skipped?.detail.startsWith("Google auth unavailable:")), "true");
});
