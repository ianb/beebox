/**
 * `cb chat ui` — ask the user's connected chat client which controls are on
 * screen right now, and print them as the dump the agent reads.
 *
 * The sibling of `cb chat screenshot` (`chat.ts`): the same agent-bearer
 * long-poll against a route that parks the call until a browser tab answers,
 * with the same honest outcome set. It has one less outcome — there is no
 * consent prompt, so nothing can be `declined` — and its success path is text
 * rather than a file: the payload is rendered by the pure formatter in
 * `core/chat/ui-dump.ts`.
 */

import { Command } from "commander";

import { isRecord } from "../../lib/is-record.js";
import { resolveChatSessionId } from "../../core/chat/session/session-id-file.js";
import { loopbackHeaders } from "./chat-audio.js";
import { formatUiDump } from "../../core/chat/ui-dump.js";
import { uiScanPayloadSchema } from "../../shared/ui-scan.js";

interface UiOptions {
  session?: string;
  timeout?: string;
}

export const uiCommand = new Command("ui")
  .description("Ask the user's connected chat client which controls are on screen, and how to point at them")
  .option("--session <id>", "Target chat session ID (defaults to CB_CHAT_SESSION_ID)")
  .option("--timeout <seconds>", "How long to wait for the client to answer (default 20)")
  .action(async (options: UiOptions) => {
    const label = "cb chat ui";
    const serverUrl = process.env.CB_SERVER_URL;
    const boxName = process.env.CB_BOX_NAME;
    if (!serverUrl) {
      console.error(`${label}: CB_SERVER_URL is not set`);
      process.exit(1);
    }
    if (!boxName) {
      console.error(`${label}: CB_BOX_NAME is not set`);
      process.exit(1);
    }

    const session = options.session ?? (await resolveChatSessionId());
    if (!session) {
      console.error(
        `${label}: no session — pass --session <id> or run inside a chat session (CB_CHAT_SESSION_ID)`
      );
      process.exit(1);
    }

    const timeoutSeconds = options.timeout !== undefined ? Number(options.timeout) : 20;
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      console.error(`${label}: invalid --timeout ${options.timeout}`);
      process.exit(1);
    }

    let status: number;
    let body: string;
    try {
      const url = `${serverUrl.replace(/\/+$/, "")}/${boxName}/api/chat/ui/request`;
      const timeoutMs = Math.round(timeoutSeconds * 1000);
      const res = await fetch(url, {
        method: "POST",
        headers: loopbackHeaders(),
        body: JSON.stringify({ session, timeoutMs }),
        // The long-poll runs up to `timeoutMs` server-side; give the socket ~10s
        // of headroom so a client-side abort never masquerades as the outcome.
        signal: AbortSignal.timeout(timeoutMs + 10_000),
      });
      status = res.status;
      body = await res.text();
    } catch (e) {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (_e) {
      console.error(`error: server returned ${status}: ${body}`);
      process.exit(1);
    }

    if (status === 200) {
      // The client's answer already passed the route's strict schema; re-parse
      // here so a mismatched server version is a clear error, not a bad dump.
      const payload = uiScanPayloadSchema.safeParse(parsed);
      if (!payload.success) {
        console.error(`error: malformed scan payload: ${body}`);
        process.exit(1);
      }
      process.stdout.write(formatUiDump(payload.data));
      return;
    }

    const bag = isRecord(parsed) ? parsed : {};
    const errorCode = typeof bag["error"] === "string" ? bag["error"] : "";
    // No `declined` case: this flow has no consent prompt, so nothing can
    // produce one (see `webapp/routes/chat-ui-routes.ts`).
    switch (errorCode) {
      case "no-client":
        console.error("no-client: no client is attached to this chat session");
        break;
      case "timeout":
        console.error(`timeout: the request was seen but not answered within ${timeoutSeconds}s`);
        break;
      case "failed": {
        const reason = typeof bag["reason"] === "string" ? bag["reason"] : "unknown";
        console.error(`failed: ${reason}`);
        break;
      }
      default:
        console.error(`error: server returned ${status}: ${body}`);
    }
    process.exit(1);
  });
