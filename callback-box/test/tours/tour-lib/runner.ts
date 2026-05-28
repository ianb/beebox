/**
 * Run a single tour. One BrowseSession drives Chrome; viewport switches
 * happen inside captureCheckpoint so each checkpoint produces both
 * desktop and mobile artifacts from the same page state.
 *
 * The dev router lazy-starts the worktree on the first navigation; we
 * don't manage it.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowseSession } from "./browse.js";
import { captureCheckpoint } from "./checkpoint.js";
import { buildExpectAPI } from "./expect.js";
import { writeSummary } from "./summary.js";
import type {
  CheckpointRecord,
  ClickLocator,
  Finding,
  TourContext,
  TourDefinition,
  TourResult,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOURS_DIR = path.resolve(__dirname, "..");
const ARTIFACTS_ROOT = path.join(TOURS_DIR, ".artifacts");

interface RunOptions {
  /** Worktree-relative URL base, e.g. http://localhost:3210/main/test1 */
  baseUrl: string;
}

export async function runTour(tour: TourDefinition, options: RunOptions): Promise<TourResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runId = startedAt.replace(/[:.]/g, "-");
  const artifactsDir = path.join(ARTIFACTS_ROOT, tour.name, runId);

  const session = new BrowseSession(`tour-${tour.name}`);

  const findings: Finding[] = [];
  const checkpoints: CheckpointRecord[] = [];
  let currentCheckpoint = "<before first checkpoint>";

  const ctx: TourContext = {
    async go(target) {
      const url = target.startsWith("/") ? `${options.baseUrl}${target}` : target;
      await session.open(url);
    },
    async checkpoint(name) {
      currentCheckpoint = name;
      const record = await captureCheckpoint({ name, artifactsDir, session });
      checkpoints.push(record);
    },
    async click(locator: ClickLocator) {
      await clickIn(session, locator);
    },
    async eval(expr) {
      return session.eval(expr);
    },
    expect: buildExpectAPI({
      session,
      checkpointName: () => currentCheckpoint,
      pushFinding: (f) => findings.push(f),
    }),
  };

  try {
    await tour.fn(ctx);
  } finally {
    await session.close();
  }

  return writeSummary({
    tour,
    startedAt,
    durationMs: Date.now() - t0,
    artifactsDir,
    checkpoints,
    findings,
  });
}

async function clickIn(session: BrowseSession, locator: ClickLocator): Promise<void> {
  const ref = await session.findRef(locator.role, locator.name);
  if (ref === null) {
    throw new Error(`Could not resolve ${locator.role} "${locator.name}" in ${session.session}`);
  }
  await session.clickRef(ref);
}
