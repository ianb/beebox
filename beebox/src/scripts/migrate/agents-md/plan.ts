/**
 * `agents-md-2026-10`: rename every box `CLAUDE.md` to `AGENTS.md`, with its
 * template-ledger entry and parked update. The whole decision, as a pure
 * function of what the runner scanned, so a doctest reaches every state with
 * no box on disk; `run.ts` is the IO around it
 * (docs/implemented-plans/box-agents-md.md, Track B).
 *
 * **Pre-scan.** Any conflict stops the run before a write. A conflict is a
 * directory holding a real `CLAUDE.md` and a real `AGENTS.md` (not a symlink,
 * not a legacy generated mirror); a `CLAUDE.local.md` or `.claude/CLAUDE.md`;
 * a ledger entry under both sibling keys with different contents; or a parked
 * update under both sibling paths with different contents. Identical ledger
 * entries or parks are not conflicts: the legacy copy is dropped. Two real
 * instruction files are never merged; a person chooses.
 *
 * **Order.** Directories convert parents before descendants (by path depth,
 * root first), so after any interruption a session at any `cwd` either finds
 * a `CLAUDE.md` at or above it, with every directory below still unconverted,
 * or finds none. Per directory: the file, then the ledger entry (moved whole,
 * `stock` included), then the parked update. The plan is computed from a fresh
 * scan, so a retry emits only the steps an interrupted run did not finish.
 */

import { isDeepStrictEqual } from "node:util";
import * as path from "node:path";
import { AGENTS_MD, CLAUDE_LOCAL_MD, CLAUDE_MD } from "../../../core/agent-instruction-files.js";
import type { VersionsFile } from "../../../core/install-template-file.js";
import { assertNever } from "../../../shared/invariant.js";

/** What sits at `<dir>/CLAUDE.md`. `target` is the symlink's raw link text. */
export type ClaudeState = { kind: "absent" } | { kind: "file" } | { kind: "symlink"; target: string };
/** What sits at `<dir>/AGENTS.md`. `generated`: a legacy generated mirror (marker text). */
export type AgentsState = { kind: "absent" } | { kind: "symlink" } | { kind: "file"; generated: boolean };

export interface DirectoryInput {
  /** Box-relative directory, `""` for the box root. */
  dir: string;
  claude: ClaudeState;
  agents: AgentsState;
}

export interface AgentsMdInputs {
  /** Every walked directory that holds a `CLAUDE.md` or an `AGENTS.md`. */
  directories: DirectoryInput[];
  /** Box-relative paths of every `CLAUDE.local.md`. */
  localFiles: string[];
  /** `_config/template-versions.json`. */
  ledger: VersionsFile;
  /** Parked updates of instruction files: original box-relative path → content. */
  parks: Record<string, string>;
}

export type Step =
  /** Rename `from` onto `to`, replacing what `replaces` names. */
  | { kind: "rename"; from: string; to: string; replaces: "absent" | "symlink" | "generated" }
  /** Delete a `CLAUDE.md` symlink to the sibling real `AGENTS.md`. */
  | { kind: "remove-link"; path: string }
  /** Move the ledger entry `from` to `to`; `drop`: `to` already holds an equal entry. */
  | { kind: "ledger"; from: string; to: string; drop: boolean }
  /** Move the park of `from` to the park of `to` (original paths); `drop`: an equal park is there. */
  | { kind: "park"; from: string; to: string; drop: boolean };

export type ConflictKind = "both-files" | "local-file" | "dangling-link" | "ledger" | "park";
export interface Conflict { kind: ConflictKind; path: string; message: string }
export interface AgentsMdPlan { steps: Step[]; conflicts: Conflict[] }

const join = (dir: string, name: string): string => (dir === "" ? name : `${dir}/${name}`);
const depth = (dir: string): number => (dir === "" ? 0 : dir.split("/").length);
const dirOf = (rel: string): string => {
  const dir = path.posix.dirname(rel);
  return dir === "." ? "" : dir;
};

/** A `CLAUDE.md` symlink whose link text names the sibling `AGENTS.md`. */
function linksToAgents(claude: ClaudeState): boolean {
  return claude.kind === "symlink" && path.posix.normalize(claude.target) === AGENTS_MD;
}

function fileStep(entry: DirectoryInput): { step: Step | null; conflict: Conflict | null } {
  const { dir, claude, agents } = entry;
  const from = join(dir, CLAUDE_MD);
  const to = join(dir, AGENTS_MD);
  if (claude.kind === "absent") return { step: null, conflict: null };
  if (path.posix.basename(dir) === ".claude") {
    return { step: null, conflict: { kind: "local-file", path: from, message: `${from}: Claude Code loads it as project instructions and then ignores every AGENTS.md. Move its content into the box root AGENTS.md (or a .claude/rules file) and delete it.` } };
  }
  if (linksToAgents(claude)) {
    if (agents.kind === "file") return { step: { kind: "remove-link", path: from }, conflict: null };
    return { step: null, conflict: { kind: "dangling-link", path: from, message: `${from}: a symlink to ${to}, which is not a file. Delete the symlink, or replace it with the instructions it should hold.` } };
  }
  if (agents.kind === "file" && !agents.generated) {
    return { step: null, conflict: { kind: "both-files", path: from, message: `${from} and ${to} are both instruction files. Merge them into ${to} by hand and delete ${from}.` } };
  }
  const replaces = agents.kind === "absent" ? "absent" : agents.kind === "symlink" ? "symlink" : "generated";
  return { step: { kind: "rename", from, to, replaces }, conflict: null };
}

function ledgerStep(ledger: VersionsFile, dir: string): { step: Step | null; conflict: Conflict | null } {
  const from = join(dir, CLAUDE_MD);
  const to = join(dir, AGENTS_MD);
  if (!Object.hasOwn(ledger, from)) return { step: null, conflict: null };
  if (!Object.hasOwn(ledger, to)) return { step: { kind: "ledger", from, to, drop: false }, conflict: null };
  if (isDeepStrictEqual(ledger[from], ledger[to])) return { step: { kind: "ledger", from, to, drop: true }, conflict: null };
  return { step: null, conflict: { kind: "ledger", path: from, message: `_config/template-versions.json has different entries for ${from} and ${to}. Delete the entry that does not describe the file on disk, then rerun.` } };
}

function parkStep(parks: Record<string, string>, dir: string): { step: Step | null; conflict: Conflict | null } {
  const from = join(dir, CLAUDE_MD);
  const to = join(dir, AGENTS_MD);
  const legacy = parks[from];
  if (legacy === undefined) return { step: null, conflict: null };
  const current = parks[to];
  if (current === undefined) return { step: { kind: "park", from, to, drop: false }, conflict: null };
  if (current === legacy) return { step: { kind: "park", from, to, drop: true }, conflict: null };
  return { step: null, conflict: { kind: "park", path: from, message: `_config/_template-updates/ holds different parked updates for ${from} and ${to}. Delete the stale one under _config/_template-updates/, then rerun.` } };
}

/** The ordered steps, or the conflicts that stop the run before any write. */
export function planAgentsMd(inputs: AgentsMdInputs): AgentsMdPlan {
  const byDir = new Map(inputs.directories.map((entry) => [entry.dir, entry]));
  const dirs = new Set(byDir.keys());
  for (const rel of [...Object.keys(inputs.ledger), ...Object.keys(inputs.parks)]) {
    if (path.posix.basename(rel) === CLAUDE_MD) dirs.add(dirOf(rel));
  }
  const ordered = [...dirs].toSorted((a, b) => depth(a) - depth(b) || a.localeCompare(b));

  const steps: Step[] = [];
  const conflicts: Conflict[] = inputs.localFiles.toSorted().map((rel) => ({
    kind: "local-file" as const,
    path: rel,
    message: `${rel}: Claude Code loads ${CLAUDE_LOCAL_MD} only beside CLAUDE.md files. Move its content into ${join(dirOf(rel), AGENTS_MD)} and delete it.`,
  }));
  for (const dir of ordered) {
    const entry = byDir.get(dir) ?? { dir, claude: { kind: "absent" }, agents: { kind: "absent" } };
    for (const { step, conflict } of [fileStep(entry), ledgerStep(inputs.ledger, dir), parkStep(inputs.parks, dir)]) {
      if (step !== null) steps.push(step);
      if (conflict !== null) conflicts.push(conflict);
    }
  }
  return conflicts.length > 0 ? { steps: [], conflicts } : { steps, conflicts };
}

/** The ledger after one `ledger` step: the whole entry (`stock` included) under the new key. */
export function rekeyLedger(ledger: VersionsFile, step: { from: string; to: string; drop: boolean }): VersionsFile {
  const next: VersionsFile = { ...ledger };
  const entry = next[step.from];
  delete next[step.from];
  if (!step.drop && entry !== undefined) next[step.to] = entry;
  return next;
}

/** One line per step, for the run log. */
export function describeStep(step: Step): string {
  switch (step.kind) {
    case "rename": return `rename ${step.from} -> ${step.to}${step.replaces === "absent" ? "" : ` (replaces ${step.replaces === "symlink" ? "symlink" : "generated mirror"})`}`;
    case "remove-link": return `remove ${step.path} (symlink to the sibling AGENTS.md)`;
    case "ledger": return `ledger ${step.from} -> ${step.to}${step.drop ? " (equal entry already there; drop legacy)" : ""}`;
    case "park": return `park ${step.from} -> ${step.to}${step.drop ? " (equal park already there; drop legacy)" : ""}`;
    default: return assertNever(step);
  }
}
