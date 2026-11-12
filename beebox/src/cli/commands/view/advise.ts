/**
 * Advice for `bbx view check`: the hidden `bbx view advise <slug> --snapshot
 * <path>` child and `runAdvice`, which the sweep uses to run it
 * (docs/plans/box-view-guidance-and-checks.md, Track 3, "Advisory-only
 * guarantee").
 *
 * The sweep runs advice only after a view's render child has passed, in a
 * second child under its own SIGKILL timeout, so advice can neither change a
 * view's result nor use its render time. The advise child runs no view code:
 * it parses the view's source and rebuilds each state's settled DOM from the
 * render child's snapshot (`core/views/advice/core.ts`). A crash, a
 * timeout, or unreadable output is a partial remark, `advice not checked: …`.
 */

import { Command } from "commander";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { requireBoxRoot } from "../../../lib/paths/core.js";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { resolveViewsDir } from "../../../webapp/views/compiler/compile.js";
import { mergeAdvice, renderedAdvice, viewSourceAdvice, type ViewAdvice } from "../../../core/views/advice/core.js";
import { ADVICE_PREFIX, PARTIAL_PREFIX, adviceLines, partialRemarks, viewDomSnapshotSchema } from "./check-states.js";

/** How long the sweep lets one view's advise child run. */
export const ADVICE_TIMEOUT_MS = 5_000;

/** What advice adds to a view's result. */
export interface AdviceOutcome {
  advice: ViewAdvice[];
  /** `advice not checked: …` remarks. */
  partial: string[];
}

/** Runs advice for one passing view; resolves, never rejects. */
export type AdviseRunner = (request: { boxRoot: string; slug: string; snapshotPath: string; env: NodeJS.ProcessEnv }) => Promise<AdviceOutcome>;

const notChecked = (reason: string): AdviceOutcome => ({ advice: [], partial: [`advice not checked: ${reason}`] });

/** Run an advise process and read its advice; a kill at `timeoutMs`, a failure, or bad output becomes a remark. */
export function runAdvice(opts: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<AdviceOutcome> {
  const { command, args, cwd, env, timeoutMs } = opts;
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, killSignal: "SIGKILL" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (e) => { resolve(notChecked(e.message)); });
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL") {
        resolve(notChecked(`timed out after ${String(timeoutMs / 1000)}s`));
        return;
      }
      if (code !== 0) {
        resolve(notChecked(stderr.trim().split("\n")[0] || `exited with code ${String(code ?? signal ?? "null")}`));
        return;
      }
      const { advice, unreadable } = adviceLines(stdout);
      const partial = partialRemarks(stdout);
      if (unreadable > 0) partial.push("advice not checked: unreadable output");
      resolve({ advice, partial });
    });
  });
}

/** The real advise child: `bbx view advise` from this package. */
export const spawnAdvise: AdviseRunner = ({ boxRoot, slug, snapshotPath, env }) => runAdvice({
  command: path.join(PACKAGE_ROOT, "bin", "bbx"),
  args: ["view", "advise", slug, "--snapshot", snapshotPath],
  cwd: boxRoot,
  env,
  timeoutMs: ADVICE_TIMEOUT_MS,
});

/** The advice for one view and its snapshot; remarks for states too large to judge. */
async function adviseView({ boxRoot, slug, snapshotPath }: { boxRoot: string; slug: string; snapshotPath: string }): Promise<AdviceOutcome> {
  const { viewsDir } = await resolveViewsDir(boxRoot);
  const states = z.array(viewDomSnapshotSchema).parse(JSON.parse(await fs.readFile(snapshotPath, "utf-8")));
  const found = await viewSourceAdvice(path.join(viewsDir, `${slug}.tsx`), { root: viewsDir });
  const partial: string[] = [];
  for (const state of states) {
    if (state.html === null) {
      partial.push(`advice not checked: ${state.label}: page too large`);
      continue;
    }
    found.push(...await renderedAdvice({ html: state.html, headStyles: state.headStyles }));
  }
  return { advice: mergeAdvice(found), partial };
}

export const viewAdviseCommand = new Command("advise")
  .description("Internal: print `bbx view check` advice for one passing view")
  .argument("<slug>", "View slug (the views/<slug>.tsx basename)")
  .requiredOption("--snapshot <path>", "The render child's settled DOM per state")
  .action(async (slug: string, options: { snapshot: string }) => {
    try {
      const { advice, partial } = await adviseView({ boxRoot: await requireBoxRoot(), slug, snapshotPath: options.snapshot });
      for (const a of advice) process.stdout.write(`${ADVICE_PREFIX}${JSON.stringify(a)}\n`);
      for (const remark of partial) process.stdout.write(`${PARTIAL_PREFIX}${remark}\n`);
    } catch (error) {
      process.stderr.write(`${errorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });
