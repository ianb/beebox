// # `google-docs-api` health check
//
// While Drive syncs Google Docs without the Docs API for a reason the
// boxholder can fix, the dashboard and `bbx health` carry one warning with the
// fix. It reads the diagnosis the Drive connector stored, hides it once Drive
// stops syncing, and reports a damaged file instead of resetting it. See
// docs/implemented-plans/drive-docs-api-health.md.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { makeTmpBox } from "../../../../../helpers/test-helpers.js";
import { googleDocsApiHealthChecks } from "../../../../../../src/webapp/trpc/routers/health/checks/google.js";
import { recordDocsApiDiagnosis } from "../../../../../../src/connectors/google-drive/docs-api-status.js";
import { markGoogleAuthDead, saveGoogleTokens } from "../../../../../../src/google/token-store.js";

process.env.BBX_GOOGLE_TOKENS_FILE = path.join(await mkdtemp(path.join(os.tmpdir(), "health-docs-api-")), "google-tokens.json");

void test("An open Docs API problem is one warning; none without it; a damaged file says so", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await box.write("_config/box.json", JSON.stringify({ googleServices: { drive: true } }));
  await saveGoogleTokens({ refreshToken: "rt-1", accessToken: "at-1" });

  t.check(await googleDocsApiHealthChecks(box.root), []);

  await recordDocsApiDiagnosis(box.root, () => ({
    kind: "service-disabled",
    message: "2 Google Docs are syncing without revision tracking or lossy-content details: the Google Docs API is disabled: https://enable",
    link: "https://enable",
    docs: 2,
    since: "2026-10-20T12:00:00.000Z",
  }));
  t.check(await googleDocsApiHealthChecks(box.root), [{
    name: "google-docs-api",
    ok: false,
    message: "Google Drive: 2 Google Docs are syncing without revision tracking or lossy-content details: the Google Docs API is disabled: https://enable",
    severity: "warning",
  }]);

  // Drive turned off: the warning goes at once, with no sync in between.
  // (Checked before the reauth case below, which is permanent for this file.)
  await box.write("_config/box.json", JSON.stringify({ googleServices: { drive: false } }));
  t.check(await googleDocsApiHealthChecks(box.root), []);
  await box.write("_config/box.json", JSON.stringify({ googleServices: { drive: true } }));

  // A grant that needs reauthorizing pauses Drive; the warning stays, worded
  // for the last sync.
  await markGoogleAuthDead({ reason: "invalid_grant" });
  t.check(await googleDocsApiHealthChecks(box.root), [{
    name: "google-docs-api",
    ok: false,
    message: "Google Drive is paused until Google is re-authorized. At its last sync, 2 Google Docs synced without revision tracking or lossy-content details: the Google Docs API is disabled: https://enable",
    severity: "warning",
  }]);

  await box.write("_bookkeeping/connectors/google-docs-api.state.json", "{\"version\": 2}");
  t.check(await googleDocsApiHealthChecks(box.root), [{
    name: "google-docs-api",
    ok: false,
    message: `Google Docs API status at ${path.join(box.root, "_bookkeeping/connectors/google-docs-api.state.json")} is invalid: ✖ Invalid input: expected 1\n  → at version\n✖ Invalid input: expected object, received undefined\n  → at diagnosis`,
    severity: "warning",
  }]);
});
