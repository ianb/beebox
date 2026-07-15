/**
 * Capture artifacts at a single (viewport, checkpoint) point: screenshot,
 * AX tree, axe-core violations. The runner calls this once per checkpoint
 * per pass — one pass at desktop, another at mobile.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowseSession } from "./browse.js";
import { runAxe } from "./axe.js";
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
