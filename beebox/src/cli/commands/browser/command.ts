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
 * printed, with its exit code. `bbx browser ask` is this command's own verb: it
 * saves a question for the person (docs/plans/shared-browser-ask.subplan.md).
 */

import { Command } from "commander";
import { z } from "zod";
import { EXEC_REPLY, type ExecReply } from "../../../core/browser/command-socket.js";
import { resolveChatSessionId } from "../../../core/chat/session/id-file.js";
import { loopbackHeaders } from "../../lib/loopback-headers.js";

/** What `bbx browser` with no arguments prints. */
export const BROWSER_USAGE = `bbx browser <agent-browser command>: drive the box's shared browser.

The browser keeps its logins between commands, and the person can open the
same browser from the profile menu's Web browser item.

Commands you will use:
  bbx browser open <url>          go to a page
  bbx browser snapshot -i         list the interactive elements, with refs (@e1, ...)
  bbx browser click @e1           click an element by ref
  bbx browser fill @e2 "text"     replace a field's text
  bbx browser get text @e3        read an element's text
  bbx browser screenshot          save a screenshot and print its path
  bbx browser wait --load networkidle
  bbx browser tab list            list the open tabs
  bbx browser ask "<question>"    ask the person to do a step in the browser

Take a new snapshot after the page changes, or after the person has used the
browser. Not available: batch, connect, and flags that pick another profile,
session or browser (--profile, --session, --cdp, ...); the box browser's
settings are fixed.

When to ask the person to log in or pass a check: the browser skill
(.claude/skills/browser/SKILL.md).
`;

const ERROR_BODY = z.object({ error: z.string() });

type PostOutcome = { ok: true; json: unknown; text: string } | { ok: false; message: string };

/** Post `body` to the box's own server; every failure becomes one message for stderr. */
async function postToBox(route: string, body: unknown): Promise<PostOutcome> {
  const serverUrl = process.env.BBX_SERVER_URL;
  const boxName = process.env.BBX_BOX_NAME;
  if (serverUrl === undefined || serverUrl === "" || boxName === undefined || boxName === "") {
    return { ok: false, message: "bbx browser: BBX_SERVER_URL and BBX_BOX_NAME must be set (run it from a box agent's shell)" };
  }
  const url = `${serverUrl.replace(/\/+$/, "")}/${boxName}/api/browser/${route}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: loopbackHeaders(), body: JSON.stringify(body) });
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
  return { ok: true, json, text };
}

export type BrowserExecOutcome = { ok: true; reply: ExecReply } | { ok: false; message: string };

/** Post `args` to the box's exec route. */
export async function browserExec(args: readonly string[]): Promise<BrowserExecOutcome> {
  const posted = await postToBox("exec", { args });
  if (!posted.ok) return posted;
  const reply = EXEC_REPLY.safeParse(posted.json);
  if (!reply.success) return { ok: false, message: `bbx browser: the box server's reply has the wrong shape: ${posted.text.slice(0, 200)}` };
  return { ok: true, reply: reply.data };
}

const ASK_REPLY = z.object({ replaced: z.boolean(), pageUrl: z.string().nullable() });

/** `bbx browser ask`: what to print, or why it failed. */
async function browserAsk(args: readonly string[]): Promise<{ ok: true; output: string } | { ok: false; message: string }> {
  const question = args[0];
  if (question === undefined || args.length > 1) return { ok: false, message: 'bbx browser ask: give one quoted question: bbx browser ask "Solve the check on this page, then press Done."' };
  const sessionId = await resolveChatSessionId();
  if (sessionId === null) return { ok: false, message: "bbx browser ask needs a chat to send the answer to; this run has none" };
  const posted = await postToBox("ask", { question, sessionId });
  if (!posted.ok) return posted;
  const reply = ASK_REPLY.safeParse(posted.json);
  if (!reply.success) return { ok: false, message: `bbx browser ask: the box server's reply has the wrong shape: ${posted.text.slice(0, 200)}` };
  return {
    ok: true,
    output: `${reply.data.replaced ? "Saved, replacing this chat's earlier question." : "Saved."} Put this link in your reply, then end your turn:

[Open the web browser](box-browser:)

The person's answer arrives as a chat message: "Done" or "Not done", maybe with their words.
${reply.data.pageUrl === null ? "\nThe browser is on no web page now (it may have restarted). If the question is about a page, open it with bbx browser open and ask again.\n" : ""}`,
  };
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
    if (args[0] === "ask") {
      const asked = await browserAsk(args.slice(1));
      if (asked.ok) {
        process.stdout.write(asked.output);
      } else {
        process.stderr.write(`${asked.message}\n`);
        process.exitCode = 1;
      }
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
