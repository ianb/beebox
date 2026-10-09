#!/usr/bin/env tsx
/**
 * `agents-md-2026-10` runner: rename every box `CLAUDE.md` to `AGENTS.md`, with
 * its template-ledger entry and parked update (`plan.ts` holds the decision).
 *
 * 1. Scan with the mirror pass's walk and skip list
 *    (`INSTRUCTION_WALK_SKIP_DIRS`): every `CLAUDE.md`, `AGENTS.md`, and
 *    `CLAUDE.local.md`, the ledger, and the parked instruction files. Any
 *    conflict prints each path with its fix and exits 1 with nothing written,
 *    so `bbx engine migrate` records nothing and the box stays unconverted,
 *    still working through the instruction-file resolver. Without `--apply`
 *    the runner stops after printing the plan.
 * 2. Apply the steps in order: parents before descendants; per directory the
 *    file (an atomic rename, which replaces a symlink or legacy generated
 *    mirror at `AGENTS.md`), then one ledger write, then the park.
 * 3. Remove the generation marker, so the sweep's refresh regenerates the agent
 *    guide and course skill with `AGENTS.md` wording (the marker's inputs do
 *    not include the migration manifest).
 * 4. Verify: a fresh scan must plan nothing.
 *
 * A retry after an interruption rescans and continues; a run on a converted
 * box reports "already converted".
 *
 * Usage:
 *   pnpm exec tsx src/scripts/migrate/agents-md/run.ts <boxRoot>           # plan only
 *   pnpm exec tsx src/scripts/migrate/agents-md/run.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { AGENTS_MD, CLAUDE_LOCAL_MD, CLAUDE_MD } from "../../../core/agent-instruction-files.js";
import { INSTRUCTION_WALK_SKIP_DIRS, isLegacyGeneratedAgentsFile } from "../../../core/agent-context-mirrors.js";
import { GENERATE_MARKER } from "../../../core/docs-gen/generate/core.js";
import { listParkedTemplateUpdates, parkedUpdatePath, readVersions, writeVersions } from "../../../core/install-template-file.js";
import { assertNever } from "../../../shared/invariant.js";
import { describeStep, planAgentsMd, rekeyLedger, type AgentsMdInputs, type AgentsState, type ClaudeState, type DirectoryInput, type Step } from "./plan.js";

async function scanDirectory(boxRoot: string, { dir, names }: { dir: string; names: Set<string> }): Promise<DirectoryInput> {
  const abs = (name: string): string => path.join(boxRoot, dir, name);
  let claude: ClaudeState = { kind: "absent" };
  if (names.has(CLAUDE_MD)) {
    const info = await fs.lstat(abs(CLAUDE_MD));
    claude = info.isSymbolicLink() ? { kind: "symlink", target: await fs.readlink(abs(CLAUDE_MD)) } : { kind: "file" };
  }
  let agents: AgentsState = { kind: "absent" };
  if (names.has(AGENTS_MD)) {
    const info = await fs.lstat(abs(AGENTS_MD));
    agents = info.isSymbolicLink()
      ? { kind: "symlink" }
      : { kind: "file", generated: isLegacyGeneratedAgentsFile(await fs.readFile(abs(AGENTS_MD), "utf8")) };
  }
  return { dir, claude, agents };
}

/** Everything the plan reads, from one walk of the box. */
async function scan(boxRoot: string): Promise<AgentsMdInputs> {
  const directories: DirectoryInput[] = [];
  const localFiles: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const names = new Set<string>();
    for (const entry of await fs.readdir(path.join(boxRoot, dir), { withFileTypes: true })) {
      if (INSTRUCTION_WALK_SKIP_DIRS.has(entry.name)) continue;
      const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel);
      else if (entry.name === CLAUDE_LOCAL_MD) localFiles.push(rel);
      else if ((entry.name === CLAUDE_MD || entry.name === AGENTS_MD) && (entry.isFile() || entry.isSymbolicLink())) names.add(entry.name);
    }
    if (names.size > 0) directories.push(await scanDirectory(boxRoot, { dir, names }));
  };
  await walk("");
  const parks: Record<string, string> = {};
  for (const rel of await listParkedTemplateUpdates(boxRoot)) {
    const base = path.posix.basename(rel);
    if (base === CLAUDE_MD || base === AGENTS_MD) parks[rel] = await fs.readFile(path.join(boxRoot, parkedUpdatePath(rel)), "utf8");
  }
  return { directories, localFiles, ledger: await readVersions(boxRoot), parks };
}

async function applyStep(boxRoot: string, step: Step): Promise<void> {
  const abs = (rel: string): string => path.join(boxRoot, rel);
  switch (step.kind) {
    case "rename":
      await fs.rename(abs(step.from), abs(step.to));
      return;
    case "remove-link":
      await fs.rm(abs(step.path));
      return;
    case "ledger":
      await writeVersions(boxRoot, rekeyLedger(await readVersions(boxRoot), step));
      return;
    case "park":
      if (step.drop) await fs.rm(abs(parkedUpdatePath(step.from)));
      else await fs.rename(abs(parkedUpdatePath(step.from)), abs(parkedUpdatePath(step.to)));
      return;
    default:
      assertNever(step);
  }
}

export type RunMode = "plan" | "apply";

/**
 * One run over one box. Returns the exit code and the lines it printed.
 * `stopAfter` applies only that many steps and returns (doctests use it to
 * leave each interruption state); the marker is then left in place.
 */
export async function runAgentsMd({ boxRoot, mode, stopAfter }: { boxRoot: string; mode: RunMode; stopAfter?: number }): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const plan = planAgentsMd(await scan(boxRoot));
  if (plan.conflicts.length > 0) {
    for (const conflict of plan.conflicts) lines.push(`conflict (${conflict.kind}): ${conflict.message}`);
    lines.push(`agents-md: ${String(plan.conflicts.length)} conflict(s); nothing written.`);
    return { code: 1, lines };
  }
  if (plan.steps.length === 0 && mode === "plan") {
    lines.push("agents-md: already converted.");
    return { code: 0, lines };
  }
  for (const step of plan.steps) lines.push(`${describeStep(step)}${mode === "plan" ? " (dry run; pass --apply)" : ""}`);
  if (mode === "plan") {
    lines.push(`agents-md: ${String(plan.steps.length)} step(s) planned.`);
    return { code: 0, lines };
  }
  const steps = stopAfter === undefined ? plan.steps : plan.steps.slice(0, stopAfter);
  for (const step of steps) await applyStep(boxRoot, step);
  if (steps.length < plan.steps.length) {
    lines.push(`agents-md: stopped after ${String(steps.length)} of ${String(plan.steps.length)} step(s).`);
    return { code: 1, lines };
  }
  // Always, even with no steps: an earlier run may have finished the steps
  // and stopped before this line.
  await fs.rm(path.join(boxRoot, GENERATE_MARKER), { force: true });
  const left = planAgentsMd(await scan(boxRoot));
  if (left.steps.length > 0 || left.conflicts.length > 0) {
    for (const step of left.steps) lines.push(`still pending: ${describeStep(step)}`);
    for (const conflict of left.conflicts) lines.push(`conflict (${conflict.kind}): ${conflict.message}`);
    lines.push("agents-md: verify failed.");
    return { code: 1, lines };
  }
  lines.push(plan.steps.length === 0 ? "agents-md: already converted." : `agents-md: applied ${String(plan.steps.length)} step(s).`);
  return { code: 0, lines };
}

// CLI entry — only when run directly, not when imported by a doctest.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: agents-md/run.ts <boxRoot> [--apply]\n\nRename the box's CLAUDE.md instruction files to AGENTS.md.");
    process.exit(1);
  }
  const mode: RunMode = args.includes("--apply") ? "apply" : "plan";
  const { code, lines } = await runAgentsMd({ boxRoot: path.resolve(boxRoot), mode });
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
