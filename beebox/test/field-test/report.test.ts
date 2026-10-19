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

function fiveItemRun(runDir: string): FieldRunResult {
  return {
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
  const runDir = await mkdtemp(join(tmpdir(), "bbx-field-report-"));
  await writeRunResults(fiveItemRun(runDir));

  const loaded = await loadRunResults(runDir);

  // The item table shows turn status and debrief outcome as SEPARATE columns —
  // `ask-for-recipe` is `turn-capped` on the activity and `friction` on the
  // debrief, both visible at once rather than collapsed into one verdict.
  // Findings sort failed-checks first, then activity anomalies/timeouts, then
  // everything else — regardless of checklist order. Visual flags are shown
  // verbatim per item that reached a debrief — never for `bulk-upload` or
  // `dentist-email`, which never got one — and `welcome` cited its screenshot only
  // in the separate "screenshots" answer, yet still gets linked. Harness events are
  // the raw trail, grouped by item, with run-level events first.
  await t.checkText(renderReport(loaded), `# Field test report: onboarding-first-days
«blankline»
- **Operator model:** opus
- **Chat model:** opus
- **Reactor model:** opus — the box model policy pins chat and reactor work alike
- **Started:** 2026-08-10T09:00:00.000Z (box clock 2026-08-10T09:00:00Z → 2026-08-12T09:00:00Z)
- **Wall time:** 2h 30m
- **Run directory:** \`${runDir}\`
- **Scenario source:** \`/repo/beebox/field-tests/onboarding-first-days\`
- **Completed** all checklist items
«blankline»
## Items
«blankline»
| Item | Turn status | Debrief outcome | Checks | Cleanup | Questionnaire |
|---|---|---|---|---|---|
| welcome | completed | smooth | 1/1 | keep | [questionnaires/welcome.md](questionnaires/welcome.md) |
| recipe-photo | completed | friction | 1/2 | commit | [questionnaires/recipe-photo.md](questionnaires/recipe-photo.md) |
| bulk-upload | error | (no debrief) | — | keep | — |
| ask-for-recipe | turn-capped | friction | 1/1 | keep | [questionnaires/ask-for-recipe.md](questionnaires/ask-for-recipe.md) |
| dentist-email | harness-skipped | (no debrief) | — | keep | — |
«blankline»
## Findings
«blankline»
- **recipe-photo**: check \`has-card.sh\` failed (exit 3) — \`no such card\`
- **bulk-upload**: activity ended \`error\` after 3 turn(s) — SDK result error_during_execution — see [activities/bulk-upload.md](activities/bulk-upload.md)
- **bulk-upload**: box never went quiescent — stuck on jobs (1 pending job card: intake.job.card)
- **ask-for-recipe**: activity ended \`turn-capped\` after 100 turn(s) — see [activities/ask-for-recipe.md](activities/ask-for-recipe.md)
- **ask-for-recipe**: debrief cited screenshot(s) that don't exist: 03-ghost.png
- **dentist-email**: pre-action \`inject-email\` (dentist) failed — fixture not found
«blankline»
## Visual flags (unvetted)
«blankline»
Operator-flagged, not vetted — needs human eyes. Each answer is the
operator's own visual judgment, shown verbatim; screenshots referenced by
filename are linked where they resolved.
«blankline»
### welcome
«blankline»
Nothing looked off — it all looked clean.
«blankline»
- [01-home.png](screenshots/welcome/01-home.png)
«blankline»
### recipe-photo
«blankline»
The recipe card thumbnail looked squashed — see 02-recipe.png.
«blankline»
- [02-recipe.png](screenshots/recipe-photo/02-recipe.png)
«blankline»
### ask-for-recipe
«blankline»
Something looked off in the results — see 03-ghost.png, not fully sure though.
«blankline»
- 03-ghost.png — **screenshot not found**
«blankline»
## Harness events
«blankline»
**Run-level:**
«blankline»
- server restarted: http://localhost:61234
«blankline»
**bulk-upload:**
«blankline»
- activity ended with status "error" (SDK result error_during_execution)
«blankline»
**dentist-email:**
«blankline»
- setup failed: inject-email dentist`);
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

  await t.checkText(abortedRendered, `# Field test report: onboarding-first-days
«blankline»
- **Operator model:** opus
- **Chat model:** opus
- **Reactor model:** opus — the box model policy pins chat and reactor work alike
- **Started:** 2026-08-10T09:00:00.000Z (box clock 2026-08-10T09:00:00Z → 2026-08-10T09:00:00Z)
- **Wall time:** 5m
- **Run directory:** \`${abortedRunDir}\`
- **Scenario source:** \`/repo/beebox/field-tests/onboarding-first-days\`
- **Aborted** at item \`second-item\`: operator session closed unexpectedly
«blankline»
## Items
«blankline»
| Item | Turn status | Debrief outcome | Checks | Cleanup | Questionnaire |
|---|---|---|---|---|---|
| first-contact | error | (no debrief) | — | keep | — |
«blankline»
## Findings
«blankline»
- Run aborted at \`second-item\`: operator session closed unexpectedly
- **first-contact**: activity ended \`error\` after 1 turn(s) — stream closed — see [activities/first-contact.md](activities/first-contact.md)
«blankline»
## Visual flags (unvetted)
«blankline»
_No debriefs were collected in this run — nothing to show._
«blankline»
## Harness events
«blankline»
_None._`);
});
