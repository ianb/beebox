/**
 * `revert <dir|file>...`: undo the conversion of every selected file that is
 * not verified. Its doctest comes back from the recorded blob, its test file
 * goes, and its state entry is dropped, so a later `prepare` converts it
 * again. Run before committing a batch: a commit hook lints whole trees
 * (`lint:bin`), and an unverified file on disk fails it.
 */

import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ToolOutputError } from "./errors.ts";
import { save, type StateFile } from "./state.ts";
import { REPO } from "./tools.ts";
import type { Selected } from "./verify.ts";

function blobText(blob: string): string {
  const r = spawnSync("git", ["cat-file", "-p", blob], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new ToolOutputError({ what: ["git cat-file", blob], output: r.stderr });
  return r.stdout;
}

/** Revert the selected files that are not verified; returns their doctests. */
export function revert(selected: readonly Selected[]): string[] {
  const out: string[] = [];
  const touched = new Set<StateFile>();
  for (const s of selected) {
    if (s.file.status !== "converted") continue;
    writeFileSync(join(REPO, s.doctest), blobText(s.file.blob));
    if (existsSync(join(REPO, s.file.test))) rmSync(join(REPO, s.file.test));
    Reflect.deleteProperty(s.state.files, s.doctest);
    touched.add(s.state);
    out.push(s.doctest);
  }
  for (const state of touched) save(state);
  return out;
}
