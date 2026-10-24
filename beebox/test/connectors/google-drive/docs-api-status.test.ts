// # The box's Google Docs API diagnosis
//
// `nextDocsApiDiagnosis` holds every open/clear decision for the stored Docs
// API problem; `readDocsApiDiagnosis` is the one reader the health check,
// settings and chat use, and it hides the problem as soon as Drive is disabled
// or Google disconnected, before any further pass could clear the file.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { instanceOf } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import {
  DocsApiStatusInvalidError,
  loadDocsApiDiagnosis,
  nextDocsApiDiagnosis,
  readDocsApiDiagnosis,
  recordDocsApiDiagnosis,
  renderDocsApiProblem,
  type DocsApiDiagnosis,
} from "../../../src/connectors/google-drive/docs-api-status.js";
import type { DocsApiOutcome } from "../../../src/connectors/google-drive/handlers/docs/api-failure.js";
import { markGoogleAuthDead, saveGoogleTokens } from "../../../src/google/token-store.js";

const tokensFile = path.join(await mkdtemp(path.join(os.tmpdir(), "docs-api-status-")), "google-tokens.json");
process.env.BBX_GOOGLE_TOKENS_FILE = tokensFile;

const NOW = new Date("2026-10-20T12:00:00.000Z");
const LATER = new Date("2026-10-21T12:00:00.000Z");

const disabled: DocsApiOutcome = {
  ok: false,
  failure: { kind: "service-disabled", message: "the Google Docs API is disabled: https://enable", link: "https://enable" },
};
const noScope: DocsApiOutcome = {
  ok: false,
  failure: { kind: "scope-insufficient", message: "the Google token lacks the documents.readonly scope.", link: null },
};
const transient: DocsApiOutcome = { ok: false, failure: { kind: "other", message: "Google answered HTTP 500", link: null } };
const ok: DocsApiOutcome = { ok: true };

const open: DocsApiDiagnosis = {
  kind: "service-disabled",
  message: "1 Google Doc is syncing without revision tracking or lossy-content details: the Google Docs API is disabled: https://enable",
  link: "https://enable",
  docs: 1,
  since: NOW.toISOString(),
};

void test("A fixable failure opens the problem; a later pass keeps its start and recounts", async (t) => {
  t.check(nextDocsApiDiagnosis({ previous: null, outcomes: [disabled], passComplete: true, now: NOW }), open);
  // A disabled API outranks a missing scope, and the count covers both.
  t.check(nextDocsApiDiagnosis({ previous: open, outcomes: [noScope, disabled], passComplete: false, now: LATER }), {
    ...open,
    message: "2 Google Docs are syncing without revision tracking or lossy-content details: the Google Docs API is disabled: https://enable",
    docs: 2,
  });
});

void test("Only evidence clears it", async (t) => {
  const next = (outcomes: DocsApiOutcome[], passComplete: boolean) =>
    nextDocsApiDiagnosis({ previous: open, outcomes, passComplete, now: LATER });
  // A complete pass whose every Doc reached the Docs API clears it.
  t.check(next([ok, ok], true), null);
  // No Docs at all on a complete pass: the last Doc card is gone.
  t.check(next([], true), null);
  // The problem is box-wide, so one Doc that reached the Docs API clears it,
  // also on a pass that a folder cap or an unrelated failure left incomplete.
  t.check(next([ok], false), null);
  t.check(next([ok, transient], true), null);
  // An incomplete pass with no Doc pulls may have skipped a Doc that still
  // fails, so the warning stays.
  t.check(next([], false), open);
  // A transient failure alone leaves that Doc unchecked, so nothing clears.
  t.check(next([transient], true), open);
  t.check(next([transient], false), open);
  t.check(nextDocsApiDiagnosis({ previous: null, outcomes: [transient], passComplete: true, now: NOW }), null);
});

void test("The reader hides a stored problem once Drive stops syncing, before any pass", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await box.write("_config/box.json", JSON.stringify({ googleServices: { drive: true } }));
  await saveGoogleTokens({ refreshToken: "rt-1", accessToken: "at-1" });
  await recordDocsApiDiagnosis(box.root, () => open);

  t.check(await readDocsApiDiagnosis(box.root), { ...open, drivePaused: false });

  // Drive turned off for this box.
  await box.write("_config/box.json", JSON.stringify({ googleServices: { drive: false } }));
  t.check(await readDocsApiDiagnosis(box.root), null);
  await box.write("_config/box.json", JSON.stringify({ googleServices: { drive: true } }));

  // The grant needs reauthorizing: Drive is paused, but nothing has fixed the
  // Docs API, so the problem stays shown (no dismissal), marked paused.
  await markGoogleAuthDead({ reason: "invalid_grant" });
  t.check(await readDocsApiDiagnosis(box.root), { ...open, drivePaused: true });

  // Google disconnected.
  await rm(tokensFile);
  t.check(await readDocsApiDiagnosis(box.root), null);

  // The stored value itself is untouched; only the readers hide it.
  t.check(await loadDocsApiDiagnosis(box.root), open);
});

void test("One rendering for health and settings: present tense, or past while Drive is paused", async (t) => {
  t.check(renderDocsApiProblem({ ...open, drivePaused: false }, { linkShownSeparately: false }), `Google Drive: ${open.message}`);
  t.check(
    renderDocsApiProblem({ ...open, drivePaused: false }, { linkShownSeparately: true }),
    "Google Drive: 1 Google Doc is syncing without revision tracking or lossy-content details: the Google Docs API is disabled.",
  );
  t.check(
    renderDocsApiProblem({ ...open, drivePaused: true }, { linkShownSeparately: false }),
    "Google Drive is paused until Google is re-authorized. At its last sync, 1 Google Doc synced without revision tracking or lossy-content details: the Google Docs API is disabled: https://enable",
  );
  // A hand-edited message still reads as the last sync.
  t.check(
    renderDocsApiProblem({ ...open, message: "something else", link: null, drivePaused: true }, { linkShownSeparately: true }),
    "Google Drive is paused until Google is re-authorized. At its last sync: something else",
  );
});

void test("A damaged file is reported, not reset", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await box.write("_bookkeeping/connectors/google-docs-api.state.json", JSON.stringify({ version: 1, diagnosis: { kind: "nope" } }));
  const readError: unknown = await loadDocsApiDiagnosis(box.root).catch((e: unknown) => e);
  t.check(readError, instanceOf(DocsApiStatusInvalidError));
});
