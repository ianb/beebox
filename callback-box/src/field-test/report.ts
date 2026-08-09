/**
 * `report.md` — the human-readable rollup of a field run
 * (`docs/plans/agent-field-tests.md`, Track 5).
 *
 * `renderReport` is a pure function over `FieldRunResult` (`results.ts`) —
 * everything it needs is already on disk after `runFieldScenario`, so it never
 * touches the box, the server, or the operator session. That is what makes it
 * regenerable after the fact (`cb field-test report <run-dir>`) and testable
 * against a fixture with no real run behind it.
 *
 * Two rules keep the report trustworthy rather than merely readable:
 *
 * - **Findings come from structured signals only** — failed checks, harness
 *   events, and the questionnaire's own bookkeeping (unanswered questions,
 *   unresolved screenshot refs). Never from paraphrasing the operator's prose:
 *   a report that summarized free-text answers would be a second, lossier copy
 *   of the questionnaire, and the two could quietly disagree. The questionnaire
 *   is linked instead (`questionnaires/<item-id>.md`), verbatim.
 * - **Visual flags are unvetted by construction.** The `rendering` answer is
 *   the operator's own uncorroborated visual judgment (`questionnaire.ts`
 *   says so directly), so it gets its own section, labeled as needing a human,
 *   and is never merged into findings.
 */

import * as path from "node:path";
import { writeFileAtomic } from "../lib/atomic-write.js";
import type {
  CheckResult,
  FieldRunResult,
  ItemResult,
} from "./results.js";

/** Filename of the rendered report inside the run directory. */
export const REPORT_FILENAME = "report.md";

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (finishedAt === null) return "(run did not finish)";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "(unknown)";
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(minutes)}m`;
}

function questionnaireLink(itemId: string): string {
  return `questionnaires/${itemId}.md`;
}

function activityLink(itemId: string): string {
  return `activities/${itemId}.md`;
}

// Known, narrow limitation: `verifyScreenshotRefs` (questionnaire.ts) resolves
// a cited filename against the WHOLE run's screenshots tree (by design — the
// operator cites bare filenames, and matching only within one item's directory
// would make a legitimately-taken screenshot unresolvable). This link assumes
// the common case — the operator saved it under THIS item's directory, as the
// activity brief instructs — so a filename reused across two items' folders
// can link to the wrong one. `resolved` itself is still correct either way.
function screenshotLink(item: ItemResult, filename: string): string {
  return path.posix.join(item.screenshotsDir, filename);
}

function renderHeader(result: FieldRunResult): string[] {
  return [
    `# Field test report: ${result.scenario}`,
    "",
    `- **Operator model:** ${result.models.operator}`,
    `- **Box-agent model:** ${result.models.box}`,
    `- **Started:** ${result.startedAt} (box clock ${result.boxTimeStart} → ${result.boxTimeEnd})`,
    `- **Wall time:** ${formatDuration(result.startedAt, result.finishedAt)}`,
    `- **Run directory:** \`${result.runDir}\``,
    `- **Scenario source:** \`${result.scenarioDir}\``,
    result.aborted !== null
      ? `- **Aborted** at item \`${result.aborted.itemId ?? "(setup)"}\`: ${result.aborted.reason}`
      : "- **Completed** all checklist items",
    "",
  ];
}

function debriefOutcomeCell(item: ItemResult): string {
  if (item.debrief !== null) return item.debrief.outcome;
  if (item.debriefSkipped !== null) return "(no debrief)";
  return "—";
}

function checksCell(item: ItemResult): string {
  if (item.checks.length === 0) return "—";
  const passed = item.checks.filter((c) => c.passed).length;
  return `${String(passed)}/${String(item.checks.length)}`;
}

function renderItemTable(result: FieldRunResult): string[] {
  if (result.items.length === 0) return ["_No items ran._", ""];
  const rows = result.items.map((item) => {
    const debrief = item.debrief !== null ? `[${questionnaireLink(item.id)}](${questionnaireLink(item.id)})` : "—";
    return `| ${item.id} | ${item.activity.status} | ${debriefOutcomeCell(item)} | ${checksCell(item)} | ${item.cleanup.policy} | ${debrief} |`;
  });
  return [
    "## Items",
    "",
    "| Item | Turn status | Debrief outcome | Checks | Cleanup | Questionnaire |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ];
}

interface Finding {
  /** Sort key — lower sorts first. Failed checks, then aborts/timeouts, then
   *  everything else, each in checklist order within its own group. */
  rank: 0 | 1 | 2;
  text: string;
}

// `harness-skipped` is not here: it is the EXPECTED shape of an item whose
// `pre` action failed, already surfaced by `otherFindings`'s pre-action check.
// These three are all activity ANOMALIES — the operator was live but the
// activity did not end cleanly.
const ABNORMAL_ACTIVITY_STATUSES = new Set(["timed-out", "turn-capped", "error"]);

function checkFindings(item: ItemResult): Finding[] {
  return item.checks
    .filter((c): c is CheckResult & { passed: false } => !c.passed)
    .map((c) => ({
      rank: 0,
      text:
        `**${item.id}**: check \`${c.script}\` failed (exit ${c.exitCode ?? "null"})` +
        (c.stderr.trim() === "" ? "" : ` — \`${c.stderr.trim().split("\n")[0]}\``),
    }));
}

function activityAnomalyFindings(item: ItemResult): Finding[] {
  const findings: Finding[] = [];
  if (ABNORMAL_ACTIVITY_STATUSES.has(item.activity.status)) {
    const detail = item.activity.status === "error" && item.activity.error !== null ? ` — ${item.activity.error}` : "";
    findings.push({
      rank: 1,
      text: `**${item.id}**: activity ended \`${item.activity.status}\` after ${String(item.activity.turns)} turn(s)${detail} — see [${activityLink(item.id)}](${activityLink(item.id)})`,
    });
  }
  if (!item.quiescence.quiescent) {
    const stuck = item.quiescence.stuck.map((s) => (s.detail === null ? s.name : `${s.name} (${s.detail})`));
    findings.push({
      rank: 1,
      text: `**${item.id}**: box never went quiescent — stuck on ${stuck.join(", ") || "(unnamed component)"}`,
    });
  }
  return findings;
}

function otherFindings(item: ItemResult): Finding[] {
  const findings: Finding[] = [];
  for (const pre of item.pre) {
    if (!pre.ok) {
      findings.push({ rank: 2, text: `**${item.id}**: pre-action \`${pre.type}\` (${pre.detail}) failed — ${pre.error ?? "no detail"}` });
    }
  }
  if (item.debrief !== null) {
    if (item.debrief.unanswered.length > 0) {
      findings.push({
        rank: 2,
        text: `**${item.id}**: questionnaire question(s) left unanswered after re-ask: ${item.debrief.unanswered.join(", ")}`,
      });
    }
    if (item.debrief.missingScreenshots.length > 0) {
      findings.push({
        rank: 2,
        text: `**${item.id}**: debrief cited screenshot(s) that don't exist: ${item.debrief.missingScreenshots.join(", ")}`,
      });
    }
    if (item.debrief.outcome === "unresolved") {
      findings.push({
        rank: 2,
        text: `**${item.id}**: outcome answer did not parse as smooth/friction/blocked${item.debrief.outcomeReason === null ? "" : ` — ${item.debrief.outcomeReason}`}`,
      });
    }
  }
  if (item.cleanup.error !== null) {
    findings.push({ rank: 2, text: `**${item.id}**: cleanup (${item.cleanup.policy}) failed — ${item.cleanup.error}` });
  }
  return findings;
}

function renderFindings(result: FieldRunResult): string[] {
  const findings: Finding[] = [];
  if (result.aborted !== null) {
    findings.push({ rank: 1, text: `Run aborted at \`${result.aborted.itemId ?? "(setup)"}\`: ${result.aborted.reason}` });
  }
  for (const item of result.items) {
    findings.push(...checkFindings(item), ...activityAnomalyFindings(item), ...otherFindings(item));
  }
  findings.sort((a, b) => a.rank - b.rank);
  if (findings.length === 0) return ["## Findings", "", "None — every check passed and nothing timed out or aborted.", ""];
  return ["## Findings", "", ...findings.map((f) => `- ${f.text}`), ""];
}

/**
 * The unvetted visual-flags section: the operator's own answer to the
 * `rendering` question, verbatim, per item that reached a debrief — never
 * filtered or judged here, because deciding which flags are "real" is exactly
 * the human step this section exists to hand off to.
 */
function renderVisualFlags(result: FieldRunResult): string[] {
  const withRendering = result.items.filter((item) => item.debrief !== null);
  if (withRendering.length === 0) {
    return ["## Visual flags (unvetted)", "", "_No debriefs were collected in this run — nothing to show._", ""];
  }
  const lines = [
    "## Visual flags (unvetted)",
    "",
    "Operator-flagged, not vetted — needs human eyes. Each answer is the",
    "operator's own visual judgment, shown verbatim; screenshots referenced by",
    "filename are linked where they resolved.",
    "",
  ];
  for (const item of withRendering) {
    const debrief = item.debrief;
    if (debrief === null) continue;
    const answer = debrief.answers.find((a) => a.id === "rendering");
    lines.push(`### ${item.id}`, "");
    lines.push(answer !== undefined && answer.answer.trim() !== "" ? answer.answer.trim() : "_(no answer)_", "");
    // The questionnaire asks WHICH screenshots show the described issue as a
    // separate question ("screenshots"), so a filename cited there and not
    // repeated inline in the rendering answer must still get its link — else
    // an operator who answered exactly as asked would silently lose the link.
    const screenshotsAnswer = debrief.answers.find((a) => a.id === "screenshots")?.answer ?? "";
    const mentionedIn = `${answer?.answer ?? ""}\n${screenshotsAnswer}`;
    const cited = debrief.screenshotRefs.filter((ref) => mentionedIn.includes(ref.filename));
    if (cited.length > 0) {
      lines.push(
        ...cited.map((ref) =>
          ref.resolved
            ? `- [${ref.filename}](${screenshotLink(item, ref.filename)})`
            : `- ${ref.filename} — **screenshot not found**`,
        ),
        "",
      );
    }
  }
  return lines;
}

/** The raw chronological event log: run-level events, then each item's own
 *  events in checklist order. Deliberately unfiltered and unordered-by-
 *  severity — this is the harness's own trail, not a triage view. */
function renderHarnessEvents(result: FieldRunResult): string[] {
  const lines = ["## Harness events", ""];
  if (result.events.length === 0 && result.items.every((item) => item.events.length === 0)) {
    return [...lines, "_None._", ""];
  }
  if (result.events.length > 0) {
    lines.push("**Run-level:**", "", ...result.events.map((e) => `- ${e}`), "");
  }
  for (const item of result.items) {
    if (item.events.length === 0) continue;
    lines.push(`**${item.id}:**`, "", ...item.events.map((e) => `- ${e}`), "");
  }
  return lines;
}

/** Render `report.md`'s full content from a run's raw result. Pure — no I/O. */
export function renderReport(result: FieldRunResult): string {
  return [
    ...renderHeader(result),
    ...renderItemTable(result),
    ...renderFindings(result),
    ...renderVisualFlags(result),
    ...renderHarnessEvents(result),
  ].join("\n");
}

/** Render and write `report.md` into the run directory. */
export async function writeFieldReport(result: FieldRunResult): Promise<void> {
  await writeFileAtomic(path.join(result.runDir, REPORT_FILENAME), { content: renderReport(result) });
}
