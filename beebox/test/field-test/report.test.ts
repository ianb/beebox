// # Field-test report rendering
//
// `renderReport` (`src/field-test/report.ts`) turns a run's `results.json` into
// `report.md` — pure and read-only, so it can be regenerated any time after a run
// with `bbx field-test report <run-dir>` (`docs/implemented-plans/agent-field-tests.md`,
// Track 5). These examples write a `FieldRunResult` fixture through the real
// writer (`writeRunResults`), read it back through the real loader
// (`loadRunResults`, which validates against the on-disk schema), and render it —
// the same path `bbx field-test report` takes.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeRunResults, loadRunResults, type FieldRunResult } from "../../src/field-test/results.js";
import { renderReport } from "../../src/field-test/report.js";

const emptyQuiescence = { quiescent: true, waitedMs: 1_000, stuck: [] };
const noCleanupError = { head: "abc123", resetTo: null, serverRestarted: false, error: null };

function debrief(opts: {
  outcome: "smooth" | "friction" | "blocked" | "unresolved";
  rendering: string;
  /** The separate "which screenshots show this" answer — filenames cited
   *  ONLY here (not repeated inline in `rendering`) must still get linked. */
  screenshots?: string;
  screenshotRefs?: { filename: string; resolved: boolean }[];
  unanswered?: string[];
}) {
  return {
    answers: [
      { id: "accomplished", question: "Did you accomplish it?", answer: "Yes.", reAsked: false },
      { id: "rendering", question: "Anything look off?", answer: opts.rendering, reAsked: false },
      { id: "screenshots", question: "Which screenshots show this?", answer: opts.screenshots ?? "", reAsked: false },
      { id: "outcome", question: "Overall?", answer: opts.outcome, reAsked: false },
    ],
    outcome: opts.outcome,
    outcomeReason: opts.outcome === "unresolved" ? "did not lead with an outcome word" : null,
    unanswered: opts.unanswered ?? [],
    screenshotRefs: opts.screenshotRefs ?? [],
    missingScreenshots: (opts.screenshotRefs ?? []).filter((r) => !r.resolved).map((r) => r.filename),
  };
}

// ## A run covering five item shapes
void test("A run covering five item shapes", async (t) => {
  t.teardown(async () => {
    try {
      await rm(runDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L49
  const runDir = await mkdtemp(join(tmpdir(), "bbx-field-report-"));
  const runResult: FieldRunResult = {
    scenario: "onboarding-first-days",
    scenarioDir: "/repo/beebox/field-tests/onboarding-first-days",
    runDir,
    startedAt: "2026-08-10T09:00:00.000Z", finishedAt: "2026-08-10T11:30:00.000Z",
    boxTimeStart: "2026-08-10T09:00:00Z", boxTimeEnd: "2026-08-12T09:00:00Z",
    models: { operator: "opus", chat: "opus" },
    serverBaseUrl: "http://localhost:61234",
    browseSession: "field-onboarding-first-days-2026-08-10",
    aborted: null,
    events: ["server restarted: http://localhost:61234"],
    items: [
      {
        id: "welcome",
        brief: "See what this is.",
        screenshotsDir: "screenshots/welcome",
        pre: [],
        activity: { status: "completed", turns: 5, note: "Looked around, found the empty state.", error: null },
        debrief: debrief({
          outcome: "smooth",
          rendering: "Nothing looked off — it all looked clean.",
          // Cited ONLY in the separate "screenshots" answer, never repeated
          // inline in `rendering` — the link must still show up.
          screenshots: "01-home.png shows the empty-state screen I started from.",
          screenshotRefs: [{ filename: "01-home.png", resolved: true }],
        }),
        debriefSkipped: null,
        quiescence: emptyQuiescence,
        checks: [{ script: "passes.sh", passed: true, exitCode: 0, stdout: "looked around\n", stderr: "" }],
        cleanup: { policy: "keep", tag: "field-run/01-welcome", ...noCleanupError },
        events: [],
      },
      {
        id: "recipe-photo",
        brief: "Save this recipe photo.",
        screenshotsDir: "screenshots/recipe-photo",
        pre: [],
        activity: { status: "completed", turns: 12, note: "Uploaded the photo.", error: null },
        debrief: debrief({
          outcome: "friction",
          rendering: "The recipe card thumbnail looked squashed — see 02-recipe.png.",
          screenshotRefs: [{ filename: "02-recipe.png", resolved: true }],
        }),
        debriefSkipped: null,
        quiescence: emptyQuiescence,
        checks: [
          { script: "passes.sh", passed: true, exitCode: 0, stdout: "", stderr: "" },
          { script: "has-card.sh", passed: false, exitCode: 3, stdout: "", stderr: "no such card\n" },
        ],
        cleanup: { policy: "commit", tag: "field-run/02-recipe-photo", ...noCleanupError },
        events: [],
      },
      {
        id: "bulk-upload",
        brief: "Upload the household photos.",
        screenshotsDir: "screenshots/bulk-upload",
        pre: [],
        activity: { status: "error", turns: 3, note: "", error: "SDK result error_during_execution" },
        debrief: null,
        debriefSkipped: "activity ended with status \"error\" (SDK result error_during_execution)",
        quiescence: {
          quiescent: false,
          waitedMs: 600_000,
          stuck: [{ name: "jobs", detail: "1 pending job card: intake.job.card" }],
        },
        checks: [],
        cleanup: { policy: "keep", tag: "field-run/03-bulk-upload", ...noCleanupError },
        events: ["activity ended with status \"error\" (SDK result error_during_execution)"],
      },
      {
        id: "ask-for-recipe",
        brief: "Ask for the recipe back.",
        screenshotsDir: "screenshots/ask-for-recipe",
        pre: [],
        activity: { status: "turn-capped", turns: 100, note: "Ran out of turns looking for search.", error: null },
        debrief: debrief({
          outcome: "friction",
          rendering: "Something looked off in the results — see 03-ghost.png, not fully sure though.",
          screenshotRefs: [{ filename: "03-ghost.png", resolved: false }],
        }),
        debriefSkipped: null,
        quiescence: emptyQuiescence,
        checks: [{ script: "passes.sh", passed: true, exitCode: 0, stdout: "", stderr: "" }],
        cleanup: { policy: "keep", tag: "field-run/04-ask-for-recipe", ...noCleanupError },
        events: [],
      },
      {
        id: "dentist-email",
        brief: "See what arrived.",
        screenshotsDir: "screenshots/dentist-email",
        pre: [{ type: "inject-email", detail: "dentist", ok: false, error: "fixture not found" }],
        activity: { status: "harness-skipped", turns: 0, note: "", error: "setup failed: inject-email dentist" },
        debrief: null,
        debriefSkipped: "setup failed: inject-email dentist",
        quiescence: emptyQuiescence,
        checks: [],
        cleanup: { policy: "keep", tag: "field-run/05-dentist-email", ...noCleanupError },
        events: ["setup failed: inject-email dentist"],
      },
    ],
  };
  await writeRunResults(runResult);

  // doctest:L155
  const loaded = await loadRunResults(runDir);
  const rendered = renderReport(loaded);

  // The header names the operator and chat models, states plainly that the reactor
  // model is unpinned, gives the box-clock span, and whether the run completed.

  // doctest:L163
  await t.checkText(rendered.split("\n").slice(0, 7).join("\n"), `# Field test report: onboarding-first-days
«blankline»
- **Operator model:** opus
- **Chat model:** opus
«*»
- **Started:** 2026-08-10T09:00:00.000Z (box clock 2026-08-10T09:00:00Z → 2026-08-12T09:00:00Z)
- **Wall time:** 2h 30m`);

  // The item table shows turn status and debrief outcome as SEPARATE columns —
  // `ask-for-recipe` is `turn-capped` on the activity and `friction` on the
  // debrief, both visible at once rather than collapsed into one verdict.

  // doctest:L179
  await t.checkText(rendered.includes("| welcome | completed | smooth | 1/1 | keep |"), "true");

  // doctest:L182
  await t.checkText(rendered.includes("| ask-for-recipe | turn-capped | friction | 1/1 | keep |"), "true");

  // doctest:L185
  await t.checkText(rendered.includes("| bulk-upload | error | (no debrief) | — | keep |"), "true");

  // Findings sort failed-checks first, then activity anomalies/timeouts, then
  // everything else — regardless of checklist order. `recipe-photo`'s check
  // failure (item 2) sorts ahead of `bulk-upload`'s quiescence timeout (item 3),
  // which sorts ahead of `dentist-email`'s pre-action failure (item 5).

  // doctest:L195
  const findingsBlock = rendered.split("## Findings")[1]!.split("## Visual flags")[0]!;
  const findingLines = findingsBlock.split("\n").filter((l) => l.startsWith("- "));
  t.check(findingLines[0], "- **recipe-photo**: check `has-card.sh` failed (exit 3) — `no such card`");

  // doctest:L200
  await t.checkText(findingLines.some((l) => l.includes("**bulk-upload**: activity ended `error`") && l.includes("SDK result error_during_execution")), "true");

  // doctest:L203
  await t.checkText(findingLines.some((l) => l.includes("**bulk-upload**: box never went quiescent — stuck on jobs (1 pending job card: intake.job.card)")), "true");

  // doctest:L206
  await t.checkText(findingLines.some((l) => l.includes("**ask-for-recipe**: activity ended `turn-capped`")), "true");

  // doctest:L209
  await t.checkText(findingLines.some((l) => l.includes("**ask-for-recipe**: debrief cited screenshot(s) that don't exist: 03-ghost.png")), "true");

  // doctest:L212
  await t.checkText(findingLines.some((l) => l.includes("**dentist-email**: pre-action `inject-email` (dentist) failed — fixture not found")), "true");

  // The failed-check finding (rank 0) is first; the two rank-1 activity/quiescence
  // findings for `bulk-upload` and `ask-for-recipe` both precede the rank-2
  // pre-action finding for `dentist-email`.

  // doctest:L221
  await t.checkText(findingLines.findIndex((l) => l.includes("dentist-email")) > findingLines.findIndex((l) => l.includes("ask-for-recipe")), "true");

  // Visual flags are shown verbatim per item that reached a debrief — never for
  // `bulk-upload` or `dentist-email`, which never got one. `recipe-photo`'s cited
  // screenshot resolved to a link; `ask-for-recipe`'s did not, and says so. `welcome`
  // cited its screenshot only in the separate "screenshots" answer — not repeated
  // inline in `rendering` — and still gets linked.

  // doctest:L232
  const flagsBlock = rendered.split("## Visual flags")[1]!.split("## Harness events")[0]!;

  // doctest:L234
  await t.checkText(flagsBlock.includes("### welcome"), "true");

  // doctest:L237
  await t.checkText(flagsBlock.includes("[01-home.png](screenshots/welcome/01-home.png)"), "true");

  // doctest:L240
  await t.checkText(flagsBlock.includes("### recipe-photo"), "true");

  // doctest:L243
  await t.checkText(flagsBlock.includes("[02-recipe.png](screenshots/recipe-photo/02-recipe.png)"), "true");

  // doctest:L246
  await t.checkText(flagsBlock.includes("### ask-for-recipe"), "true");

  // doctest:L249
  await t.checkText(flagsBlock.includes("03-ghost.png — **screenshot not found**"), "true");

  // doctest:L252
  await t.checkText(flagsBlock.includes("### bulk-upload"), "false");

  // doctest:L255
  await t.checkText(flagsBlock.includes("### dentist-email"), "false");

  // Harness events are the raw trail, grouped by item, with run-level events
  // first — not the curated findings view above.

  // doctest:L263
  const eventsBlock = rendered.split("## Harness events")[1]!;

  // doctest:L265
  await t.checkText(eventsBlock.includes("**Run-level:**"), "true");

  // doctest:L268
  await t.checkText(
    eventsBlock.includes("server restarted: http://localhost:61234")
    ,
    "true",
  );

  // doctest:L271
  await t.checkText(eventsBlock.includes("**bulk-upload:**"), "true");

  // doctest:L274
  await t.checkText(eventsBlock.includes("**dentist-email:**"), "true");

  // doctest:L277
  await t.checkText(eventsBlock.includes("**welcome:**"), "false");
});

// ## An aborted run with no debriefs collected
//
// When the operator session dies before any item finishes debriefing, the
// header says so, the abort itself is a finding, and the visual-flags section
// says plainly that there is nothing to show rather than silently omitting it.
void test("When the operator session dies before any item finishes debriefing, the heade...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(abortedRunDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L292
  const abortedRunDir = await mkdtemp(join(tmpdir(), "bbx-field-report-abort-"));
  const abortedResult: FieldRunResult = {
    scenario: "onboarding-first-days",
    scenarioDir: "/repo/beebox/field-tests/onboarding-first-days",
    runDir: abortedRunDir,
    startedAt: "2026-08-10T09:00:00.000Z",
    finishedAt: "2026-08-10T09:05:00.000Z",
    boxTimeStart: "2026-08-10T09:00:00Z",
    boxTimeEnd: "2026-08-10T09:00:00Z",
    models: { operator: "opus", chat: "opus" },
    serverBaseUrl: "http://localhost:61234",
    browseSession: "field-onboarding-first-days-2026-08-10-abort",
    aborted: { itemId: "second-item", reason: "operator session closed unexpectedly" },
    events: [],
    items: [
      {
        id: "first-contact",
        brief: "See what this is.",
        screenshotsDir: "screenshots/first-contact",
        pre: [],
        activity: { status: "error", turns: 1, note: "", error: "stream closed" },
        debrief: null,
        debriefSkipped: "activity ended with status \"error\" (stream closed)",
        quiescence: emptyQuiescence,
        checks: [],
        cleanup: { policy: "keep", tag: "field-run/01-first-contact", ...noCleanupError },
        events: [],
      },
    ],
  };
  await writeRunResults(abortedResult);
  const abortedRendered = renderReport(await loadRunResults(abortedRunDir));

  // doctest:L325
  await t.checkText(abortedRendered.includes("- **Aborted** at item `second-item`: operator session closed unexpectedly"), "true");

  // doctest:L328
  const abortedFindings = abortedRendered.split("## Findings")[1]!.split("## Visual flags")[0]!;
  await t.checkText(abortedFindings.trim().startsWith("- Run aborted at `second-item`: operator session closed unexpectedly"), "true");

  // doctest:L332
  await t.checkText(abortedRendered.includes("_No debriefs were collected in this run — nothing to show._"), "true");
});
