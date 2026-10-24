// # admin.googleStatus — the Drive line for an open Docs API problem
//
// The Google settings section shows, under the Drive toggle, that Docs are
// syncing without the Docs API and where to fix it. The line comes from the
// diagnosis the Drive connector stored; it is hidden once Drive is off, and a
// damaged status file leaves the settings page working (the health check
// reports the damage). See docs/implemented-plans/drive-docs-api-health.md.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { recordDocsApiDiagnosis } from "../../../../src/connectors/google-drive/docs-api-status.js";
import { markGoogleAuthDead, saveGoogleTokens } from "../../../../src/google/token-store.js";
import { grantSecret, setSecret } from "../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";

process.env.BBX_GOOGLE_TOKENS_FILE = path.join(await mkdtemp(path.join(os.tmpdir(), "admin-google-status-")), "google-tokens.json");

console.error = () => {};

void test("The Drive line follows the stored diagnosis, and Drive being off hides it", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const slug = await boxSlug(box.root);
  for (const name of ["google-oauth-client-id", "google-oauth-client-secret"]) {
    await setSecret({ name, value: `placeholder-${name}` });
    await grantSecret({ slug, name, access: "server" });
  }
  await box.write("_config/box.json", JSON.stringify({ googleServices: { drive: true } }));
  await saveGoogleTokens({ refreshToken: "rt-1", accessToken: "at-1" });
  const admin = appRouter.createCaller(trpcContext({ boxRoot: box.root, user: { email: "owner@example.com", name: "Owner" }, isAuthenticatedOwner: true })).admin;
  const driveLine = async () => (await admin.googleStatus()).driveDocsApi;

  t.check(await driveLine(), null);

  await recordDocsApiDiagnosis(box.root, () => ({
    kind: "service-disabled",
    message: "1 Google Doc is syncing without revision tracking or lossy-content details: the Google Docs API is disabled: https://enable",
    link: "https://enable",
    docs: 1,
    since: "2026-10-20T12:00:00.000Z",
  }));
  // The link is its own control on the page, so the text drops it: the URL shows once.
  t.check(await driveLine(), {
    message: "Google Drive: 1 Google Doc is syncing without revision tracking or lossy-content details: the Google Docs API is disabled.",
    link: "https://enable",
  });

  await box.write("_config/box.json", JSON.stringify({ googleServices: { drive: false } }));
  t.check(await driveLine(), null);
  await box.write("_config/box.json", JSON.stringify({ googleServices: { drive: true } }));

  // Paused for reauthorization: still shown, in the past tense.
  await markGoogleAuthDead({ reason: "invalid_grant" });
  t.check(await driveLine(), {
    message: "Google Drive is paused until Google is re-authorized. At its last sync, 1 Google Doc synced without revision tracking or lossy-content details: the Google Docs API is disabled.",
    link: "https://enable",
  });

  await box.write("_bookkeeping/connectors/google-docs-api.state.json", "{\"version\": 2}");
  t.check(await driveLine(), null);
});
