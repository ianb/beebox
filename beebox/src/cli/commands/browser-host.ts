/**
 * `bbx engine browser-host --box <root> --slug <slug>`: the box browser host
 * (docs/plans/shared-browser.md, Track B). The engine spawns one per box
 * (`src/core/browser/host/start.ts`); nothing else should run it. It runs the
 * agent-browser dashboard and the relay socket until SIGTERM.
 *
 * `--state-dir` exists for tests, whose temporary home gives a socket path
 * over the Unix limit; the engine passes its own state directory.
 */

import * as path from "node:path";
import { Command } from "commander";
import { runBrowserHost } from "../../core/browser/host-process/run.js";
import { BBX_STATE_DIR } from "../../lib/state-dir.js";

export const browserHostCommand = new Command("browser-host")
  .description("Run one box's browser host (the engine starts it; not for direct use)")
  .requiredOption("--box <root>", "The box root directory")
  .requiredOption("--slug <slug>", "The box's URL slug")
  .option("--state-dir <dir>", "The state directory holding the browser profile", BBX_STATE_DIR)
  .action(async (opts: { box: string; slug: string; stateDir: string }) => {
    await runBrowserHost({ boxRoot: path.resolve(opts.box), slug: opts.slug, stateDir: path.resolve(opts.stateDir) });
    // A dashboard or relay handle left open must not keep a stopped host alive.
    process.exit(0);
  });
