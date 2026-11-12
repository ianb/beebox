/**
 * Capture artifacts at a single (viewport, checkpoint) point: screenshot,
 * AX tree, axe-core violations. The runner calls this once per checkpoint
 * per pass — one pass at desktop, another at mobile.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowseSession } from "./browse.js";
import { runAxe } from "./axe.js";
import { auditBackdrops, describeBackdropFailure } from "./backdrop.js";
import { auditContrast, describeContrastFailure, mergeContrastSteps } from "./contrast.js";
import { ambiguousControls, describeAmbiguous, scanPage } from "./labels.js";
import type { CheckpointArtifact, Finding, ViewportSpec } from "./types.js";

export interface CaptureInput {
  name: string;
  artifactsDir: string;
  viewport: ViewportSpec;
  session: BrowseSession;
  /** Degradations during capture (readiness timeout, axe crash) surface here. */
  pushFinding: (finding: Finding) => void;
}

export interface CaptureResult {
  artifact: CheckpointArtifact;
  url: string;
  title: string;
}

export async function captureCheckpoint(input: CaptureInput): Promise<CaptureResult> {
  const { name, artifactsDir, viewport, session, pushFinding } = input;

  await mkdir(artifactsDir, { recursive: true });

  const ready = await session.waitForReady();
  if (!ready) {
    pushFinding({
      severity: "warn",
      checkpoint: name,
      viewport: viewport.name,
      message: "page readiness wait timed out — artifacts may show a loading state",
    });
  }
  const [url, title] = await Promise.all([session.getUrl(), session.getTitle()]);

  const screenshotPath = path.join(artifactsDir, `${name}.${viewport.name}.png`);
  const axSnapshotPath = path.join(artifactsDir, `${name}.${viewport.name}.ax.txt`);
  const axeReportPath = path.join(artifactsDir, `${name}.${viewport.name}.axe.json`);

  await session.screenshot(screenshotPath);
  const ax = await session.snapshot({ interactiveOnly: false });

  await writeFile(axSnapshotPath, ax, "utf8");

  let violationCount = 0;
  try {
    const violations = await runAxe(session);
    violationCount = violations.length;

    await writeFile(axeReportPath, JSON.stringify(violations, null, 2), "utf8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    await writeFile(axeReportPath, JSON.stringify({ error: message }, null, 2), "utf8");
    // Without this finding, an axe crash reads as "0 violations" in the
    // summary — indistinguishable from a clean page.
    pushFinding({
      severity: "warn",
      checkpoint: name,
      viewport: viewport.name,
      message: `axe run failed (violation count is meaningless): ${message}`,
    });
  }

  await auditCheckpointContrast({ ...input, reportPath: path.join(artifactsDir, `${name}.${viewport.name}.contrast.json`) });
  await auditCheckpointBackdrops(input);
  await auditCheckpointLabels({ ...input, reportPath: path.join(artifactsDir, `${name}.${viewport.name}.labels.json`) });

  return {
    url,
    title,
    artifact: {
      viewport: viewport.name,
      screenshotPath,
      axSnapshotPath,
      axeReportPath,
      axeViolationCount: violationCount,
    },
  };
}

/**
 * The pixel contrast audit stands in for axe's color-contrast rule, which
 * declines to measure themed text (see axe.ts). One finding per checkpoint
 * names the first misses; the report holds them all.
 */
async function auditCheckpointContrast(input: CaptureInput & { reportPath: string }): Promise<void> {
  const { name, viewport, session, pushFinding, reportPath } = input;
  try {
    const result = mergeContrastSteps([await auditContrast(session, { outline: false })]);
    await writeFile(reportPath, JSON.stringify(result, null, 2), "utf8");
    const misses = result.failures.length + result.unmeasured.length;
    if (misses === 0) return;
    const shown = result.failures.slice(0, 6).map((f) => `\n  - ${describeContrastFailure(f)}`).join("");
    const more = misses > 6 ? `\n  - … ${String(misses - 6)} more in ${path.basename(reportPath)}` : "";
    pushFinding({ severity: "fail", checkpoint: name, viewport: viewport.name, message: `${String(misses)} contrast or material misses${shown}${more}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await writeFile(reportPath, JSON.stringify({ error: message }, null, 2), "utf8");
    pushFinding({ severity: "warn", checkpoint: name, viewport: viewport.name, message: `contrast audit failed (no contrast result for this checkpoint): ${message}` });
  }
}

/** Theme artwork that repeats or stops short at this screen size. */
async function auditCheckpointBackdrops(input: CaptureInput): Promise<void> {
  const { name, viewport, session, pushFinding } = input;
  try {
    const result = await auditBackdrops(session);
    const lines = [...result.failures.map((f) => describeBackdropFailure(f)), ...result.unloaded.map((image) => `${image} did not load, so it was not measured`)];
    if (lines.length === 0) return;
    pushFinding({ severity: "fail", checkpoint: name, viewport: viewport.name, message: `${String(lines.length)} backdrop misses${lines.map((l) => `\n  - ${l}`).join("")}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    pushFinding({ severity: "warn", checkpoint: name, viewport: viewport.name, message: `backdrop audit failed (no backdrop result for this checkpoint): ${message}` });
  }
}

/**
 * Controls the box agent cannot tell apart (labels.ts). A finding, not a gate:
 * the weekly tour check files it or fixes the names.
 */
async function auditCheckpointLabels(input: CaptureInput & { reportPath: string }): Promise<void> {
  const { name, viewport, session, pushFinding, reportPath } = input;
  try {
    const scan = await scanPage(session);
    if (scan === null) {
      await writeFile(reportPath, JSON.stringify({ skipped: "no window.__bbxUiScan on this page" }, null, 2), "utf8");
      pushFinding({ severity: "info", checkpoint: name, viewport: viewport.name, message: "label audit skipped: the page has no UI scan hook (not an app page?)" });
      return;
    }
    const ambiguous = ambiguousControls(scan.entries);
    await writeFile(reportPath, JSON.stringify({ ambiguous, truncated: scan.truncated, duplicateIds: scan.duplicateIds }, null, 2), "utf8");
    if (scan.truncated) {
      pushFinding({ severity: "warn", checkpoint: name, viewport: viewport.name, message: "label audit incomplete: the UI scan hit its entry cap" });
    }
    if (ambiguous.length === 0) return;
    const shown = ambiguous.slice(0, 6).map((g) => `\n  - ${describeAmbiguous(g)}`).join("");
    const more = ambiguous.length > 6 ? `\n  - … ${String(ambiguous.length - 6)} more in ${path.basename(reportPath)}` : "";
    pushFinding({ severity: "fail", checkpoint: name, viewport: viewport.name, message: `${String(ambiguous.length)} control names the agent cannot tell apart${shown}${more}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    pushFinding({ severity: "warn", checkpoint: name, viewport: viewport.name, message: `label audit failed (no label result for this checkpoint): ${message}` });
  }
}
