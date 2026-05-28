/**
 * Run a single tour as two full passes — one at desktop viewport,
 * one at mobile — so clicks and snapshots happen at a fixed viewport
 * throughout each pass. Per-checkpoint artifacts from both passes are
 * merged by checkpoint name for the summary.
 *
 * The dev router lazy-starts the worktree on first navigation; we
 * don't manage it.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowseSession } from "./browse.js";
import { captureCheckpoint } from "./checkpoint.js";
import { buildExpectAPI } from "./expect.js";
import { writeSummary } from "./summary.js";
import { VIEWPORTS } from "./types.js";
import type {
  CheckpointArtifact,
  CheckpointRecord,
  ClickLocator,
  Finding,
  TourContext,
  TourDefinition,
  TourResult,
  ViewportSpec,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOURS_DIR = path.resolve(__dirname, "..");
const ARTIFACTS_ROOT = path.join(TOURS_DIR, ".artifacts");

interface RunOptions {
  /** Worktree-relative URL base, e.g. http://localhost:3210/main/test1 */
  baseUrl: string;
}

interface PassResult {
  checkpoints: Map<string, { url: string; title: string; artifact: CheckpointArtifact }>;
  findings: Finding[];
  error: Error | null;
}

export async function runTour(tour: TourDefinition, options: RunOptions): Promise<TourResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runId = startedAt.replace(/[:.]/g, "-");
  const artifactsDir = path.join(ARTIFACTS_ROOT, tour.name, runId);

  const passResults: PassResult[] = [];
  for (const vp of VIEWPORTS) {
    passResults.push(await runPass({ tour, viewport: vp, artifactsDir, baseUrl: options.baseUrl }));
  }

  const checkpoints = mergeCheckpoints(passResults);
  const findings = passResults.flatMap((p) => p.findings);

  return writeSummary({
    tour,
    startedAt,
    durationMs: Date.now() - t0,
    artifactsDir,
    checkpoints,
    findings,
  });
}

interface PassInput {
  tour: TourDefinition;
  viewport: ViewportSpec;
  artifactsDir: string;
  baseUrl: string;
}

async function runPass(input: PassInput): Promise<PassResult> {
  const { tour, viewport, artifactsDir, baseUrl } = input;
  const session = new BrowseSession(`tour-${tour.name}-${viewport.name}`);
  // about:blank gives Chrome a tab to apply the viewport to before the
  // tour navigates anywhere real. We skip the page-ready wait here —
  // about:blank has no JS, so the readiness signal can never settle.
  await session.open("about:blank", { noWait: true });
  await session.setViewport(viewport.width, viewport.height);

  const findings: Finding[] = [];
  const checkpoints = new Map<string, { url: string; title: string; artifact: CheckpointArtifact }>();
  let currentCheckpoint = "<before first checkpoint>";
  let error: Error | null = null;

  const ctx: TourContext = {
    async go(target) {
      const url = target.startsWith("/") ? `${baseUrl}${target}` : target;
      await session.open(url);
    },
    async checkpoint(name) {
      currentCheckpoint = name;
      const { url, title, artifact } = await captureCheckpoint({ name, artifactsDir, viewport, session });
      checkpoints.set(name, { url, title, artifact });
    },
    async click(locator: ClickLocator) {
      await clickIn(session, locator);
    },
    async eval(expr) {
      return session.eval(expr);
    },
    expect: buildExpectAPI({
      session,
      viewport: viewport.name,
      checkpointName: () => currentCheckpoint,
      pushFinding: (f) => findings.push(f),
    }),
  };

  try {
    await tour.fn(ctx);
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
    findings.push({
      severity: "fail",
      checkpoint: currentCheckpoint,
      viewport: viewport.name,
      message: `pass aborted: ${error.message}`,
    });
  } finally {
    await session.close();
  }

  return { checkpoints, findings, error };
}

function mergeCheckpoints(passes: readonly PassResult[]): CheckpointRecord[] {
  const ordered: string[] = [];
  const byName = new Map<string, CheckpointRecord>();

  for (const pass of passes) {
    for (const [name, entry] of pass.checkpoints) {
      let record = byName.get(name);
      if (record === undefined) {
        record = { name, url: entry.url, title: entry.title, artifacts: [] };
        byName.set(name, record);
        ordered.push(name);
      }
      record.artifacts.push(entry.artifact);
    }
  }

  return ordered.map((name) => {
    const record = byName.get(name);
    if (record === undefined) throw new Error(`internal: lost checkpoint ${name}`);
    return record;
  });
}

async function clickIn(session: BrowseSession, locator: ClickLocator): Promise<void> {
  const ref = await session.findRef(locator.role, locator.name);
  if (ref === null) {
    throw new Error(`Could not resolve ${locator.role} "${locator.name}"`);
  }
  await session.clickRef(ref);
}
