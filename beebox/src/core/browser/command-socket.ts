/**
 * The command socket's wire format and its engine-side client
 * (docs/plans/shared-browser.md, "Command socket" and Track C's exec route).
 *
 * The agent's `bbx browser` commands run inside the browser host, not in the
 * engine: on a unit host the host is inside the box's private network
 * namespace, and an agent-browser command that finds no daemon starts one in
 * whatever process runs it. The host listens on `<root>/cli.sock`; each
 * connection carries one JSON request `{ args }` and gets one JSON line
 * `{ exitCode, stdout, stderr }` back.
 */

import net from "node:net";
import { z } from "zod";

/** How long the host lets one agent-browser command run before killing it. */
export const COMMAND_TIMEOUT_MS = 120_000;

/** The exit code the host reports for a command it killed at the timeout (as `timeout(1)` does). */
export const TIMED_OUT_EXIT_CODE = 124;

/** The client waits a little past the host's own timeout, so the host's answer arrives first. */
const CLIENT_TIMEOUT_MS = COMMAND_TIMEOUT_MS + 10_000;

/** The host's answer: the CLI's exit code and its text output. */
export const EXEC_REPLY = z.object({ exitCode: z.number().int(), stdout: z.string(), stderr: z.string() }).strict();
export type ExecReply = z.infer<typeof EXEC_REPLY>;

/** The command socket did not answer with a reply. */
export class BrowserCommandSocketError extends Error {
  override name = "BrowserCommandSocketError";
  constructor(readonly what: { readonly socketPath: string; readonly detail: string }) {
    super(`The box browser's command socket ${what.socketPath} did not answer: ${what.detail}`);
  }
}

/** Send `args` to the browser host's command socket and wait for the CLI's result. */
export function sendBrowserCommand(socketPath: string, args: readonly string[]): Promise<ExecReply> {
  return new Promise((resolve, reject) => {
    const fail = (detail: string): void => {
      socket.destroy();
      reject(new BrowserCommandSocketError({ socketPath, detail }));
    };
    const socket = net.connect(socketPath);
    socket.setEncoding("utf8");
    socket.setTimeout(CLIENT_TIMEOUT_MS, () => fail(`no reply within ${String(CLIENT_TIMEOUT_MS / 1000)} s`));
    let text = "";
    socket.on("data", (chunk: string) => (text += chunk));
    socket.on("error", (e) => fail(e.message));
    socket.on("end", () => {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (_e) {
        fail(`the reply is not JSON: ${text.slice(0, 200)}`);
        return;
      }
      const parsed = EXEC_REPLY.safeParse(json);
      if (!parsed.success) {
        fail(`the reply has the wrong shape: ${z.prettifyError(parsed.error)}`);
        return;
      }
      socket.destroy();
      resolve(parsed.data);
    });
    socket.end(`${JSON.stringify({ args })}\n`);
  });
}
