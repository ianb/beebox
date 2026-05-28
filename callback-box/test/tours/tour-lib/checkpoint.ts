/**
 * A checkpoint captures, at both viewports in parallel:
 *   - a screenshot
 *   - the AX tree (full snapshot, semantic)
 *   - axe-core violations
 *
 * Files land in <artifactsDir>/<checkpointName>.{desktop|mobile}.{png|ax.txt|axe.json}.
 * Sidecar URL + title come from the desktop session.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowseSession } from "./browse.js";
import { runAxe } from "./axe.js";
import { VIEWPORTS } from "./types.js";
import type { CheckpointArtifact, CheckpointRecord, ViewportSpec } from "./types.js";

export interface CheckpointInput {
  name: string;
  artifactsDir: string;
  session: BrowseSession;
}

export async function captureCheckpoint(input: CheckpointInput): Promise<CheckpointRecord> {
  const { name, artifactsDir, session } = input;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- artifactsDir is built from a static base + tour name
  await mkdir(artifactsDir, { recursive: true });

  // Read URL/title once at the page's current state — independent of viewport.
  const urlAndTitle = await readUrlAndTitle(session);

  // Capture viewports sequentially in one Chrome session. set-viewport is
  // fast (~50ms) but does trigger responsive reflow; we wait for queries
  // to settle inside capturePerViewport before reading the DOM.
  const artifacts: CheckpointArtifact[] = [];
  for (const vp of VIEWPORTS) {
    artifacts.push(await capturePerViewport({ name, artifactsDir, viewport: vp, session }));
  }

  // Leave the session at the "primary" (first) viewport so subsequent
  // tour clicks/snapshots happen against the desktop nav, not the
  // collapsed mobile hamburger.
  const primary = VIEWPORTS[0];
  if (primary !== undefined) {
    await session.setViewport(primary.width, primary.height);
  }

  return {
    name,
    url: urlAndTitle.url,
    title: urlAndTitle.title,
    artifacts,
  };
}

interface PerViewportInput {
  name: string;
  artifactsDir: string;
  viewport: ViewportSpec;
  session: BrowseSession;
}

async function capturePerViewport(input: PerViewportInput): Promise<CheckpointArtifact> {
  const { name, artifactsDir, viewport, session } = input;
  await session.setViewport(viewport.width, viewport.height);
  await session.waitForReady();

  const screenshotPath = path.join(artifactsDir, `${name}.${viewport.name}.png`);
  const axSnapshotPath = path.join(artifactsDir, `${name}.${viewport.name}.ax.txt`);
  const axeReportPath = path.join(artifactsDir, `${name}.${viewport.name}.axe.json`);

  // Sequential for one viewport, parallel across viewports — agent-browser
  // serializes per-session anyway, and these three calls all need the same
  // page state to be coherent.
  await session.screenshot(screenshotPath);
  const ax = await session.snapshot({ interactiveOnly: false });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path built from a static artifacts dir + sanitized checkpoint name
  await writeFile(axSnapshotPath, ax, "utf8");

  let violationCount = 0;
  try {
    const violations = await runAxe(session);
    violationCount = violations.length;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above
    await writeFile(axeReportPath, JSON.stringify(violations, null, 2), "utf8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above
    await writeFile(axeReportPath, JSON.stringify({ error: message }, null, 2), "utf8");
  }

  return {
    viewport: viewport.name,
    screenshotPath,
    axSnapshotPath,
    axeReportPath,
    axeViolationCount: violationCount,
  };
}

async function readUrlAndTitle(session: BrowseSession): Promise<{ url: string; title: string }> {
  const [url, title] = await Promise.all([session.getUrl(), session.getTitle()]);
  return { url, title };
}
