/**
 * Intake stage — the first stage of the triage pipeline.
 *
 * Responsibilities:
 *
 *   1. Route fresh top-level `box/inbox/*` cards into `box/inbox/intake/`.
 *      Connectors and the capture UI currently drop items at the top of
 *      `box/inbox/`; the router pulls them into the pipeline. Anything in
 *      a reserved subdirectory (intake/, staged/, triaged/, unhandled/,
 *      etc.) stays put.
 *
 *   2. Scan `box/inbox/intake/` and apply each intake step whose
 *      precondition matches. Preconditions are fast even when the work
 *      they gate is heavy. The loop repeats until no step changed
 *      anything (quiescent).
 *
 *   3. Move every remaining item into `box/inbox/staged/` — they're
 *      intake-complete and ready for the triage stage.
 *
 * See `docs/triage-design.md` for the surrounding design.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import { getBoxDir } from "../cli/lib/paths.js";

/**
 * Result of applying one intake step to one file.
 */
export interface IntakeStepResult {
  /** True if the step modified the file (renamed it, edited it, etc.). */
  changed: boolean;
  /** New basename if the step renamed the file. */
  newName?: string;
  /** Short note for operator logs (e.g. "skipped: target exists"). */
  note?: string;
}

export interface IntakeStep {
  /** Stable identifier; appears in result logs. */
  name: string;
  /**
   * Apply the step to one file in `intakeDir`. Implementations check
   * their own precondition (cheap) and only do work when needed; running
   * the step on an already-processed item must be a no-op.
   */
  apply(
    file: string,
    ctx: { intakeDir: string; boxRoot: string },
  ): Promise<IntakeStepResult>;
}

/**
 * Top-level `box/inbox/` subdirectories the arrival router must NOT
 * pull from. Anything else at the top of `box/inbox/` is treated as a
 * fresh arrival.
 */
const INBOX_RESERVED_SUBDIRS = new Set([
  "intake",
  "staged",
  "triaged",
  "unhandled",
  "feedback",
]);

const SAFE_NAME_RE = /^[\w.-]+$/;

function normalizeFilename(name: string): string {
  return name.replace(/\s+/g, "_").replace(/[^\w.-]/g, "");
}

/**
 * Rename files whose names contain whitespace or characters that bite
 * downstream shell steps. Idempotent: already-safe names are skipped.
 */
const filenameNormalizationStep: IntakeStep = {
  name: "filename-normalization",
  async apply(file, { intakeDir }) {
    if (SAFE_NAME_RE.test(file)) return { changed: false };
    const newName = normalizeFilename(file);
    if (newName === "" || newName === file) return { changed: false };

    const newPath = path.join(intakeDir, newName);
    try {
      await fs.access(newPath);
      return { changed: false, note: `skipped: ${newName} already exists` };
    } catch (_e) {
      // Target doesn't exist — safe to rename.
    }
    await fs.rename(path.join(intakeDir, file), newPath);
    return { changed: true, newName };
  },
};

export const intakeSteps: IntakeStep[] = [filenameNormalizationStep];

async function readDir(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw e;
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readDir(dir);
  return entries.filter((e) => !e.isDirectory()).map((e) => e.name);
}

/**
 * Move top-level `box/inbox/*` cards into `box/inbox/intake/`. Reserved
 * subdirectories are skipped; dotfiles are skipped; directories are
 * never moved.
 */
async function routeArrivals(opts: { boxRoot: string }): Promise<string[]> {
  const inboxDir = getBoxDir(opts.boxRoot, "inbox");
  const intakeDir = getBoxDir(opts.boxRoot, "inboxIntake");
  const entries = await readDir(inboxDir);
  if (entries.length === 0) return [];

  await fs.mkdir(intakeDir, { recursive: true });
  const moved: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Reserved subdirs are part of the pipeline; non-reserved ones
      // (legacy buckets) are left alone so existing code keeps working.
      if (!INBOX_RESERVED_SUBDIRS.has(entry.name)) continue;
      continue;
    }
    if (entry.name.startsWith(".")) continue;
    const src = path.join(inboxDir, entry.name);
    const dst = path.join(intakeDir, entry.name);
    try {
      await fs.access(dst);
      continue; // Don't clobber.
    } catch (_e) {
      // Target free.
    }
    await fs.rename(src, dst);
    moved.push(entry.name);
  }
  return moved;
}

/**
 * Move every file remaining in `intake/` into `staged/`. Items get here
 * only after every step's precondition came up false, so they're
 * intake-complete by definition.
 */
async function advanceToStaged(opts: { boxRoot: string }): Promise<string[]> {
  const intakeDir = getBoxDir(opts.boxRoot, "inboxIntake");
  const stagedDir = getBoxDir(opts.boxRoot, "inboxStaged");
  const files = await listFiles(intakeDir);
  if (files.length === 0) return [];

  await fs.mkdir(stagedDir, { recursive: true });
  const completed: string[] = [];
  for (const file of files) {
    const dst = path.join(stagedDir, file);
    try {
      await fs.access(dst);
      continue;
    } catch (_e) {
      // Target free.
    }
    await fs.rename(path.join(intakeDir, file), dst);
    completed.push(file);
  }
  return completed;
}

export interface IntakeStepEvent {
  step: string;
  file: string;
  newName?: string;
  note?: string;
}

export interface IntakeResult {
  /** Top-level inbox items that got pulled into intake/. */
  routed: string[];
  /** Each step application that changed something. */
  applied: IntakeStepEvent[];
  /** Items that advanced from intake/ to staged/ this pass. */
  staged: string[];
}

/**
 * Hard cap on quiescence loops; well above what any sane step chain
 * should need. A step that never returns `changed: false` would loop
 * forever otherwise.
 */
const MAX_PASSES = 100;

class IntakeLoopRunawayError extends Error {
  constructor() {
    super(`Intake scanner did not quiesce within ${MAX_PASSES} passes`);
    this.name = "IntakeLoopRunawayError";
  }
}

/**
 * Run one full intake pass: route arrivals → scan-loop until quiescent →
 * advance intake-complete items to staged.
 */
export async function runIntake(opts: { boxRoot: string }): Promise<IntakeResult> {
  const routed = await routeArrivals(opts);

  const intakeDir = getBoxDir(opts.boxRoot, "inboxIntake");
  await fs.mkdir(intakeDir, { recursive: true });

  const applied: IntakeStepEvent[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let progressed = false;
    for (const step of intakeSteps) {
      const files = await listFiles(intakeDir);
      for (const file of files) {
        const result = await step.apply(file, { intakeDir, boxRoot: opts.boxRoot });
        if (!result.changed && !result.note) continue;
        if (result.changed) progressed = true;
        const event: IntakeStepEvent = { step: step.name, file };
        if (result.newName) event.newName = result.newName;
        if (result.note) event.note = result.note;
        applied.push(event);
      }
    }
    if (!progressed) {
      const staged = await advanceToStaged(opts);
      return { routed, applied, staged };
    }
  }
  throw new IntakeLoopRunawayError();
}
