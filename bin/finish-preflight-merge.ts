/**
 * finish-preflight's merge of main, including the conflicts it resolves
 * without a person.
 *
 * Any conflict used to stop a headless finish (exit 3). Three of the files
 * that conflict have a resolution that needs no judgment, so preflight applies
 * it and finishes the merge. A conflict anywhere else still stops it
 * (issues/closed/code-quality/2026-10-10-append-only-and-generated-files-conflict-on-every-merge.md).
 *
 * Git's `union` driver was the first idea and is wrong for both append-only
 * files: it keeps a line shared by both sides' additions once, so a ledger row
 * or migration comment that ends like its neighbour loses its last lines.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatHistory,
  mergeHistories,
  parseHistoryText,
} from "../beebox/src/dev/lib/context-history.js";
import { MergeConflictError, MergeStateError, type StoppingMergeState } from "./finish-preflight-errors.js";
import { git, gitOrNull } from "./lib/git.js";

export interface MergeResult {
  status: "up-to-date" | "merged";
  broughtPaths: string[];
  /** Conflicted paths preflight resolved by rule, each with the rule's name. */
  resolved: string[];
  /** The leftover `MERGE_HEAD` preflight cleared before merging (see {@link readMergeState}). */
  clearedMergeHead?: string;
}

interface Stages {
  base: string;
  /** This branch. */
  ours: string;
  /** main. */
  theirs: string;
}

/** A rule that cannot apply returns null, and the conflict stops the finish. */
type ContentRule = (stages: Stages) => string | null;

const MIGRATIONS_OPEN = "export const MIGRATIONS: ReadonlyArray<Migration> = [";
const MIGRATION_ENTRY = /^\s*{ name: "([^"]+)".*},\s*$/;

interface MigrationList {
  /** Text before and after the array's entries, which neither side may change. */
  head: string[];
  tail: string[];
  /** Each entry with the comment lines above it. */
  entries: { name: string; lines: string[] }[];
}

function parseMigrationList(text: string): MigrationList | null {
  const lines = text.split("\n");
  const open = lines.indexOf(MIGRATIONS_OPEN);
  const close = lines.indexOf("];", open);
  if (open === -1 || close === -1) return null;
  const entries: MigrationList["entries"] = [];
  let pending: string[] = [];
  for (const line of lines.slice(open + 1, close)) {
    const entry = MIGRATION_ENTRY.exec(line);
    if (entry?.[1] !== undefined) {
      entries.push({ name: entry[1], lines: [...pending, line] });
      pending = [];
    } else if (/^\s*\/\//.test(line)) {
      pending.push(line);
    } else {
      // A multi-line entry or anything else unexpected: not a mechanical case.
      return null;
    }
  }
  if (pending.length > 0) return null;
  return { head: lines.slice(0, open + 1), tail: lines.slice(close), entries };
}

/**
 * `MIGRATIONS` in beebox/src/core/migrations.ts: main's list as it stands,
 * then the entries this branch appended, with their comments. That keeps
 * main's order, which deployed boxes have run, and puts the branch's new
 * migrations after it. Applies only when the branch did nothing to the file
 * but append entries.
 */
export const appendBranchMigrations: ContentRule = ({ base, ours, theirs }) => {
  const [baseList, ourList, theirList] = [base, ours, theirs].map(parseMigrationList);
  if (baseList == null || ourList == null || theirList == null) return null;
  const sameText = (a: string[], b: string[]): boolean => a.join("\n") === b.join("\n");
  if (!sameText(baseList.head, ourList.head) || !sameText(baseList.tail, ourList.tail)) return null;
  const baseEntries = baseList.entries.map((entry) => entry.lines.join("\n"));
  const ourPrefix = ourList.entries.slice(0, baseEntries.length).map((entry) => entry.lines.join("\n"));
  if (!sameText(ourPrefix, baseEntries)) return null;
  const mainNames = new Set(theirList.entries.map((entry) => entry.name));
  const appended = ourList.entries.slice(baseEntries.length);
  if (appended.some((entry) => mainNames.has(entry.name))) return null;
  return [
    ...theirList.head,
    ...theirList.entries.flatMap((entry) => entry.lines),
    ...appended.flatMap((entry) => entry.lines),
    ...theirList.tail,
  ].join("\n");
};

/** Every row of a ledger, as comparable text. */
function ledgerRows(text: string): Set<string> {
  const rows = new Set<string>();
  for (const [box, audits] of Object.entries(parseHistoryText(text))) {
    for (const [auditId, entries] of Object.entries(audits)) {
      for (const entry of entries) rows.add(JSON.stringify([box, auditId, entry]));
    }
  }
  return rows;
}

/**
 * The audit ledger: every row from either side, once, oldest first. Applies
 * only when both sides kept every base row as it was and only appended; a
 * corrected or deleted row is a person's call.
 */
export const mergeLedger: ContentRule = ({ base, ours, theirs }) => {
  const baseRows = ledgerRows(base);
  for (const side of [ours, theirs]) {
    const rows = ledgerRows(side);
    if ([...baseRows].some((row) => !rows.has(row))) return null;
  }
  return formatHistory(mergeHistories(parseHistoryText(ours), parseHistoryText(theirs)));
};

const CONTENT_RULES: Record<string, { name: string; rule: ContentRule }> = {
  "beebox/src/dev/context-history.yaml": { name: "both sides' rows", rule: mergeLedger },
  "beebox/src/core/migrations.ts": { name: "main's list + branch entries", rule: appendBranchMigrations },
};

/**
 * Generated files: rebuilt from the merged tree once every other conflict is
 * resolved, so they describe the result rather than either side.
 */
const REGENERATED: Record<string, string[]> = {
  "beebox/docs/doc-graph.md": ["pnpm", "--dir", "beebox", "--silent", "doc-graph"],
};

/** Every path must have a rule that applies, or nothing is written. */
function resolveConflicts(root: string, conflicted: string[]): string[] | null {
  if (!conflicted.every((path) => path in CONTENT_RULES || path in REGENERATED)) return null;
  const stage = (n: number, path: string): string => git(["show", `:${String(n)}:${path}`], { cwd: root, onError: "throw" });
  const writes: { path: string; text: string }[] = [];
  for (const path of conflicted) {
    const content = CONTENT_RULES[path];
    if (content === undefined) continue;
    let text: string | null;
    try {
      text = content.rule({ base: stage(1, path), ours: stage(2, path), theirs: stage(3, path) });
    } catch (e) {
      // A side that does not parse (a hand-edited ledger) is a person's call.
      console.error(`finish-preflight: ${path}: ${e instanceof Error ? e.message : String(e)}`);
      text = null;
    }
    if (text === null) return null;
    writes.push({ path, text: text.endsWith("\n") ? text : `${text}\n` });
  }
  for (const { path, text } of writes) writeFileSync(join(root, path), text);
  for (const path of conflicted) {
    const argv = REGENERATED[path];
    if (argv === undefined) continue;
    const [command = "", ...args] = argv;
    if (spawnSync(command, args, { cwd: root, stdio: "ignore" }).status !== 0) return null;
  }
  git(["add", "--", ...conflicted], { cwd: root, onError: "throw" });
  return conflicted.map((path) => `${path} (${CONTENT_RULES[path]?.name ?? "regenerated"})`);
}

const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

export type MergeState =
  | { state: "none" }
  /** HEAD already records this merge; only the metadata was left behind. */
  | { state: "finished"; mergeHead: string }
  | Exclude<StoppingMergeState, { state: "merge-failed" }>;

/**
 * What a `MERGE_HEAD` left in the worktree means. git refuses to start a merge
 * while one exists, and a merge preflight committed or a person finished by
 * hand can leave it behind
 * (issues/bugs/2026-11-13-finish-preflight-misreads-a-finished-merge.md).
 * Only "finished" is safe to clear: HEAD is a merge whose second parent is
 * MERGE_HEAD, nothing is unmerged, and nothing is staged.
 */
export function readMergeState(root: string): MergeState {
  const file = join(root, git(["rev-parse", "--git-path", "MERGE_HEAD"], { cwd: root, onError: "throw" }));
  if (!existsSync(file)) return { state: "none" };
  // git keeps one line per merged commit; rev-parse reads only the first, so an
  // octopus merge would pass the HEAD^2 check with heads left unchecked.
  const heads = lines(readFileSync(file, "utf-8"));
  const mergeHead = heads.length === 1 ? gitOrNull(["rev-parse", "-q", "--verify", `${heads[0] ?? ""}^{commit}`], { cwd: root }) : null;
  if (mergeHead === null) return { state: "unreadable", heads };
  const unmerged = lines(
    git(["diff", "--name-only", "--diff-filter=U"], {
      cwd: root,
      onError: "throw",
    }),
  );
  if (unmerged.length > 0) return { state: "conflicted", mergeHead, paths: [...new Set(unmerged)] };
  const staged = lines(
    git(["diff", "--cached", "--name-only", "HEAD"], {
      cwd: root,
      onError: "throw",
    }),
  );
  const recorded = gitOrNull(["rev-parse", "-q", "--verify", "HEAD^2"], { cwd: root }) === mergeHead;
  if (recorded)
    return staged.length === 0
      ? { state: "finished", mergeHead }
      : { state: "finished-with-staged", mergeHead, staged };
  return staged.length === 0
    ? { state: "unrecorded", mergeHead }
    : { state: "resolved-uncommitted", mergeHead, staged };
}

/**
 * Clears a provably finished leftover merge; any other merge state stops the
 * finish. `--no-merge` runs it too: a sheet read over a half-done merge would
 * describe a tree nobody committed.
 */
export function clearLeftoverMerge(root: string): string | undefined {
  const found = readMergeState(root);
  if (found.state === "none") return undefined;
  if (found.state !== "finished") throw new MergeStateError(found);
  git(["merge", "--quit"], { cwd: root, onError: "throw" });
  return found.mergeHead;
}

export function mergeMain(root: string): MergeResult {
  const clearedMergeHead = clearLeftoverMerge(root);
  const cleared = clearedMergeHead === undefined ? {} : { clearedMergeHead };
  const before = git(["rev-parse", "HEAD"], { cwd: root, onError: "throw" });
  const result = spawnSync("git", ["merge", "main"], {
    cwd: root,
    encoding: "utf-8",
  });
  let resolved: string[] = [];
  if (result.status !== 0) {
    const conflicted = lines(
      git(["diff", "--name-only", "--diff-filter=U"], {
        cwd: root,
        onError: "throw",
      }),
    );
    if (conflicted.length === 0) {
      // Not a conflict: a dirty file the merge would overwrite, a missing ref.
      throw new MergeStateError({
        state: "merge-failed",
        output: `${result.stdout}${result.stderr}`,
      });
    }
    const resolution = resolveConflicts(root, conflicted);
    const commit =
      resolution === null
        ? null
        : spawnSync("git", ["commit", "--no-edit"], {
            cwd: root,
            encoding: "utf-8",
          });
    if (resolution === null || commit?.status !== 0) {
      throw new MergeConflictError({
        conflicted: conflicted.join("\n"),
        stdout: `${result.stdout}${commit?.stdout ?? ""}`,
        stderr: `${result.stderr}${commit?.stderr ?? ""}`,
      });
    }
    resolved = resolution;
  }
  const after = git(["rev-parse", "HEAD"], { cwd: root, onError: "throw" });
  if (before === after) return { status: "up-to-date", broughtPaths: [], resolved, ...cleared };
  const brought = lines(
    git(["diff", "--name-only", "--no-renames", `${before}..HEAD`], {
      cwd: root,
      onError: "throw",
    }),
  );
  return { status: "merged", broughtPaths: brought, resolved, ...cleared };
}
