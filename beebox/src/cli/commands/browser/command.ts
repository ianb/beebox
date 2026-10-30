/**
 * `bbx browser <agent-browser args>`: the agent's one way into the box
 * browser (docs/plans/shared-browser.md, Track D).
 *
 * The agent never runs `agent-browser` itself: whichever process runs it
 * first starts its daemon and Chrome, and on a server that must happen
 * inside the box's private network namespace, which only the engine's
 * browser host is in. So this command passes its arguments, untouched, to
 * the box's own server (`POST /<slug>/api/browser/exec`), which checks them
 * and runs agent-browser inside the host, and prints what agent-browser
 * printed, with its exit code.
 */

import { Command } from "commander";
import { z } from "zod";
import { EXEC_REPLY, type ExecReply } from "../../../core/browser/command-socket.js";
import { loopbackHeaders } from "../../lib/loopback-headers.js";

/** What `bbx browser` with no arguments prints. */
export const BROWSER_USAGE = `bbx browser <agent-browser command>: drive the box's shared browser.

The browser keeps its logins between commands, and the person can open the
same browser from the profile menu's Browser item.

Commands you will use:
  bbx browser open <url>          go to a page
  bbx browser snapshot -i         list the interactive elements, with refs (@e1, ...)
  bbx browser click @e1           click an element by ref
  bbx browser fill @e2 "text"     replace a field's text
  bbx browser get text @e3        read an element's text
  bbx browser screenshot          save a screenshot and print its path
  bbx browser wait --load networkidle
  bbx browser tab list            list the open tabs

Take a new snapshot after the page changes, or after the person has used the
browser. Not available: batch, connect, and flags that pick another profile,
session or browser (--profile, --session, --cdp, ...); the box browser's
settings are fixed.
`;

const ERROR_BODY = z.object({ error: z.string() });

export type BrowserExecOutcome = { ok: true; reply: ExecReply } | { ok: false; message: string };

/** Post `args` to the box's exec route; every failure becomes one message for stderr. */
export async function browserExec(args: readonly string[]): Promise<BrowserExecOutcome> {
  const serverUrl = process.env.BBX_SERVER_URL;
  const boxName = process.env.BBX_BOX_NAME;
  if (serverUrl === undefined || serverUrl === "" || boxName === undefined || boxName === "") {
    return { ok: false, message: "bbx browser: BBX_SERVER_URL and BBX_BOX_NAME must be set (run it from a box agent's shell)" };
  }
  const url = `${serverUrl.replace(/\/+$/, "")}/${boxName}/api/browser/exec`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: loopbackHeaders(), body: JSON.stringify({ args }) });
  } catch (e) {
    return { ok: false, message: `bbx browser: the box server did not answer: ${e instanceof Error ? e.message : String(e)}` };
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    // Not JSON: reported raw below.
  }
  if (res.status !== 200) {
    const error = ERROR_BODY.safeParse(json);
    return { ok: false, message: `${error.success ? error.data.error : text} (HTTP ${String(res.status)})` };
  }
  const reply = EXEC_REPLY.safeParse(json);
  if (!reply.success) return { ok: false, message: `bbx browser: the box server's reply has the wrong shape: ${text.slice(0, 200)}` };
  return { ok: true, reply: reply.data };
}

export const browserCommand = new Command("browser")
  .description("Drive the box's shared browser (agent-browser commands)")
  .argument("[args...]", "Arguments in agent-browser's vocabulary")
  .allowUnknownOption(true)
  .action(async (args: string[]) => {
    if (args.length === 0) {
      process.stdout.write(BROWSER_USAGE);
      return;
    }
    const outcome = await browserExec(args);
    if (!outcome.ok) {
      process.stderr.write(`${outcome.message}\n`);
      process.exitCode = 1;
      return;
    }
    if (outcome.reply.stdout !== "") process.stdout.write(outcome.reply.stdout);
    if (outcome.reply.stderr !== "") process.stderr.write(outcome.reply.stderr);
    process.exitCode = outcome.reply.exitCode;
  });
