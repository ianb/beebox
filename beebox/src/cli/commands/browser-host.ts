/**
 * `bbx engine browser-host --box <root> --engine-pid <pid>`: the
 * box browser host (docs/plans/shared-browser.md, Track B). The engine spawns
 * one per box (`src/core/browser/host/start.ts`); nothing else should run it.
 * It runs the agent-browser dashboard and the relay socket until SIGTERM or
 * until the engine `--engine-pid` names is gone.
 *
 * `--state-dir` exists for tests, whose temporary home gives a socket path
 * over the Unix limit; the engine passes its own state directory.
 *
 * `--check-sandbox` is the deploy's post-install check (Track F): it opens
 * `chrome://sandbox` once through the namespace launcher with a throwaway
 * profile, prints the page only on failure, and exits 1 unless Chrome is
 * sandboxed. It needs no box.
 */

import * as path from "node:path";
import { Command } from "commander";
import { runBrowserHost } from "../../core/browser/host-process/run.js";
import { checkBrowserSandbox } from "../../core/browser/host/sandbox-check.js";
import { BBX_STATE_DIR } from "../../lib/state-dir.js";

interface BrowserHostOptions {
  readonly box?: string;
  readonly stateDir: string;
  readonly enginePid?: string;
  readonly checkSandbox?: boolean;
}

export const browserHostCommand = new Command("browser-host")
  .description("Run one box's browser host (the engine starts it; not for direct use)")
  .option("--box <root>", "The box root directory")
  .option("--state-dir <dir>", "The state directory holding the browser profile", BBX_STATE_DIR)
  .option("--engine-pid <pid>", "The engine that started the host; the host stops when it is gone")
  .option("--check-sandbox", "Check once that Chrome keeps its sandbox inside the private network (the deploy runs this)")
  .action(async (opts: BrowserHostOptions) => {
    if (opts.checkSandbox === true) {
      const result = await checkBrowserSandbox();
      if (result.ok) {
        process.stdout.write("Chrome is sandboxed inside the box browser's network namespace.\n");
        process.exit(0);
      }
      process.stderr.write(`Chrome is NOT sandboxed (or the check failed). chrome://sandbox and agent-browser said:\n${result.output}\n`);
      process.exit(1);
    }
    const { box } = opts;
    const enginePid = Number(opts.enginePid);
    if (box === undefined || !Number.isInteger(enginePid) || enginePid <= 1) {
      process.stderr.write("error: --box and --engine-pid are required unless --check-sandbox is given\n");
      process.exit(64);
    }
    await runBrowserHost({ boxRoot: path.resolve(box), stateDir: path.resolve(opts.stateDir) }, { enginePid });
    // A dashboard or relay handle left open must not keep a stopped host alive.
    process.exit(0);
  });
