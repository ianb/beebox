/**
 * One agent command on the box browser, as the exec route runs it
 * (docs/plans/agent-self-view.md, Tracks B and C): refresh the box's pass,
 * resolve box paths (`/views/...`) to the box's own pages, and send
 * `screenshot --card` to the card capture instead of upstream. Everything else
 * is upstream's command, unchanged.
 */

import * as path from "node:path";
import type { ExecReply } from "../command-socket.js";
import { resolveAppUrl } from "../app-url.js";
import { resolveBoxPaths } from "./box-path.js";
import { captureCard, type CardShotIo } from "../card-shot/run.js";
import { nextPositional } from "../exec-args.js";
import { ensureBrowserPass, forgetBrowserPass } from "./pass-install.js";

export interface AgentCommandContext extends CardShotIo {
  /** The running host's handle: the pass is installed once per host. */
  readonly host: object;
  readonly boxRoot: string;
  readonly slug: string;
  readonly env: NodeJS.ProcessEnv;
  readonly now: number;
}

const CARD_FLAG = "--card";

function refused(message: string): ExecReply {
  return { exitCode: 1, stdout: "", stderr: `${message}\n` };
}

/** `screenshot --card`, alone: any other screenshot argument is refused. */
function cardShotRequest(args: readonly string[]): "none" | "ok" | "mixed" {
  if (!args.includes(CARD_FLAG)) return "none";
  const command = nextPositional(args, 0);
  if (command === null || args[command] !== "screenshot") return "none";
  return args.length === 2 && command === 0 ? "ok" : "mixed";
}

export async function runAgentCommand(ctx: AgentCommandContext, args: readonly string[]): Promise<ExecReply> {
  const box = ctx;
  const io = ctx;
  const pass = await ensureBrowserPass({ host: box.host, boxRoot: box.boxRoot, send: io.send, env: io.env, now: io.now });
  const app = resolveAppUrl(io.env);
  const card = cardShotRequest(args);
  let result: ExecReply;
  if (card === "mixed") {
    result = refused("bbx browser: --card takes no other screenshot arguments; it captures the open card to _tmp/browser/ and prints the path");
  } else if (card === "ok") {
    if (!app.ok) return refused(`bbx browser: --card needs this box's pages: ${app.reason}`);
    const shot = await captureCard(io, { base: app.base, slug: box.slug, outDir: path.join(box.boxRoot, "_tmp", "browser"), now: new Date(io.now) });
    result = shot.ok ? { exitCode: 0, stdout: shot.output, stderr: "" } : refused(shot.message);
  } else {
    const resolved = resolveBoxPaths(args, { app, slug: box.slug });
    result = resolved.ok ? await io.send(resolved.args) : refused(resolved.message);
    // A cookie command may have removed the pass: install it again next time.
    const command = nextPositional(args, 0);
    if (command !== null && args[command] === "cookies") forgetBrowserPass(box.host);
  }
  if (pass.status !== "failed") return result;
  return { ...result, stderr: `${result.stderr}note: could not refresh the box browser's pass, so this box's own pages may ask for a login: ${pass.reason}\n` };
}
