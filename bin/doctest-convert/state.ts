/**
 * The conversion paperwork, tracked in git under `bin/doctest-convert/state/`
 * (plan retire-doctest.md, track 3): one JSON file per prepared directory,
 * holding each doctest's conversion. A new session resumes from it.
 */

import { existsSync, fsyncSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, renameSync, writeSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { StateFileError } from "./errors.ts";
import { REPO } from "./tools.ts";

export const STATE_DIR = join(REPO, "bin/doctest-convert/state");

const CheckCallSchema = z.object({ method: z.string(), actual: z.string(), expected: z.string(), line: z.number() });

const FileStateSchema = z.object({
  /** The converted test file, repo-relative. */
  test: z.string(),
  /** The doctest's blob hash when it was converted; its source is `git cat-file -p <blob>`. */
  blob: z.string(),
  status: z.enum(["converted", "verified", "landed", "strengthened"]),
  /** Every example's marker line and kind, from the converter's manifest. */
  examples: z.array(z.object({ line: z.number(), kind: z.enum(["check", "throws", "statement"]) })),
  /** Checks kept as `t.checkText`, by doctest line, with the reason. */
  textOnly: z.record(z.string(), z.string()),
  /** Doctest lines whose `t.check` is awaited: the value was a promise. */
  awaited: z.array(z.number()),
  /** The check calls the converter wrote, by marker; static fidelity compares against these. */
  checks: z.record(z.string(), z.array(CheckCallSchema)),
  /** tap's assertion count for the converted file, or null when it failed or did not run. */
  assertions: z.number().nullable(),
  /** Checks and throws in the manifest plus tests in the file: the count a faithful conversion gives. */
  expectedAssertions: z.number(),
  /** What the last prepare or verify found wrong; empty when it passed. */
  problems: z.array(z.string()),
  /** Checks whose actual value a worker changed, for review. */
  changedActuals: z.array(z.string()),
});
export type FileState = z.infer<typeof FileStateSchema>;

const StateFileSchema = z.object({
  dir: z.string(),
  files: z.record(z.string(), FileStateSchema),
});
export type StateFile = z.infer<typeof StateFileSchema>;

/** The state file for a repo-relative directory. */
export function statePath(dir: string): string {
  return join(STATE_DIR, `${dir.replace(/\/$/, "")}.json`);
}

function readStateFile(path: string): StateFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new StateFileError(relative(REPO, path), String(error));
  }
  const parsed = StateFileSchema.safeParse(raw);
  if (!parsed.success) throw new StateFileError(relative(REPO, path), parsed.error.message);
  return parsed.data;
}

/** Every state file, by repo-relative directory. */
export function loadAll(): Map<string, StateFile> {
  const out = new Map<string, StateFile>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".json")) {
        const state = readStateFile(path);
        out.set(state.dir, state);
      }
    }
  };
  walk(STATE_DIR);
  return out;
}

export function save(state: StateFile): void {
  const path = statePath(state.dir);
  mkdirSync(dirname(path), { recursive: true });
  const files = Object.fromEntries(Object.entries(state.files).toSorted(([a], [b]) => a.localeCompare(b)));
  // Written aside, flushed, and renamed: prepare deletes a doctest once its
  // entry is saved, so a half-written state file would lose it.
  const aside = `${path}.tmp`;
  const fd = openSync(aside, "w");
  try {
    writeSync(fd, `${JSON.stringify({ dir: state.dir, files }, null, 1)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(aside, path);
}

/** The state entry for a doctest, and the state file holding it. */
export function find(all: ReadonlyMap<string, StateFile>, doctest: string): { state: StateFile; file: FileState } | null {
  for (const state of all.values()) {
    const file = state.files[doctest];
    if (file !== undefined) return { state, file };
  }
  return null;
}

/** `bin/doctest-convert/PROGRESS.md`: directories by status. */
export function writeProgress(all: ReadonlyMap<string, StateFile>): void {
  const statuses = ["converted", "verified", "landed", "strengthened"] as const;
  const rows = [...all.values()]
    .toSorted((a, b) => a.dir.localeCompare(b.dir))
    .map((s) => {
      const files = Object.values(s.files);
      const counts = statuses.map((st) => files.filter((f) => f.status === st).length);
      const failing = files.filter((f) => f.problems.length > 0).length;
      return `| \`${s.dir}\` | ${files.length} | ${counts.join(" | ")} | ${failing} |`;
    });
  const text = [
    "# Doctest conversion progress",
    "",
    "Written by `bin/doctest-convert.ts` after each command; do not edit. Plan:",
    "[retire-doctest](../../beebox/docs/plans/retire-doctest.md), track 3.",
    "",
    "| Directory | Files | Converted | Verified | Landed | Strengthened | With problems |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  writeFileSync(join(REPO, "bin/doctest-convert/PROGRESS.md"), text);
}
