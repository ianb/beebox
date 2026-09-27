/**
 * `--mentions-from-git <base>`: computes an old->new path mapping from git's
 * own rename detection between `<base>` and `HEAD`, for repos where files
 * already moved (with correct imports — typecheck proves it) before this
 * tool's mention-rewrite existed. `git diff -M --find-renames` compares the
 * two endpoints directly, so it already composes a file that moved twice
 * (or more) across separate commits into one old->new pair — no chain logic
 * needed here, unlike `validate.ts`'s move-list ordering.
 *
 * A detected rename is trusted only when the working tree agrees with it:
 * `to` must exist and `from` must be absent. Git can also pair two unrelated
 * files that happen to be textually similar; a low similarity score (the
 * `R<nn>` percentage) is the signal for that, so anything under
 * `MIN_SIMILARITY` is rejected rather than trusted.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PlannedMove } from "./list.js";

export interface RejectedRename {
  from: string;
  to: string;
  reason: string;
}

export interface GitRenameResult {
  moves: PlannedMove[];
  rejected: RejectedRename[];
}

const RENAME_STATUS = /^R(\d+)$/;
const MIN_SIMILARITY = 50;

interface DetectedRename {
  from: string;
  to: string;
  score: number;
}

function parseNameStatusZ(output: string): DetectedRename[] {
  const tokens = output.split("\0").filter((s) => s.length > 0);
  const renames: DetectedRename[] = [];
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i];
    if (status === undefined) break;
    const match = RENAME_STATUS.exec(status);
    if (match === null) {
      // Non-rename status lines (A/M/D/C...) carry exactly one path; skip it.
      i += 2;
      continue;
    }
    const from = tokens[i + 1];
    const to = tokens[i + 2];
    i += 3;
    if (from === undefined || to === undefined) continue;
    renames.push({ from, to, score: Number(match[1]) });
  }
  return renames;
}

function detectRenames(params: { repoRoot: string; base: string }): DetectedRename[] {
  const out = execFileSync(
    "git",
    ["-c", "diff.renameLimit=100000", "diff", "-M", "--find-renames", "--name-status", "-z", params.base, "HEAD"],
    { cwd: params.repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  return parseNameStatusZ(out);
}

/** Computes the old->new mapping, rejecting low-similarity pairs and pairs the working tree contradicts. */
export function computeRenamesFromGit(params: { repoRoot: string; base: string }): GitRenameResult {
  const detected = detectRenames({ repoRoot: params.repoRoot, base: params.base });
  const moves: PlannedMove[] = [];
  const rejected: RejectedRename[] = [];
  for (const rename of detected) {
    if (rename.score < MIN_SIMILARITY) {
      rejected.push({ from: rename.from, to: rename.to, reason: `similarity ${rename.score} below ${MIN_SIMILARITY}` });
      continue;
    }
    const toExists = existsSync(join(params.repoRoot, rename.to));
    const fromExists = existsSync(join(params.repoRoot, rename.from));
    if (!toExists) {
      rejected.push({ from: rename.from, to: rename.to, reason: "new path does not exist in the working tree" });
      continue;
    }
    if (fromExists) {
      rejected.push({ from: rename.from, to: rename.to, reason: "old path still exists in the working tree" });
      continue;
    }
    moves.push({ from: rename.from, to: rename.to });
  }
  return { moves, rejected };
}
