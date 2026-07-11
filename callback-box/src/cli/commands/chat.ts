/**
 * cb chat - Commands that interact with the live chat session.
 *
 * - `cb chat self-note` posts an agent-authored note into the chat session
 *   transcript without triggering a conversational response.
 * - `cb chat get-last-audio` / `cb chat ask-about-audio` work with the
 *   recording of the user's most recent voice message — see chat-audio.ts.
 */

import { Command } from "commander";
import { isRecord } from "../../lib/is-record.js";
import { resolveChatSessionId } from "../../core/chat/session/session-id-file.js";
import { loopbackHeaders, getLastAudioCommand, askAboutAudioCommand, retranscribeCommand } from "./chat-audio.js";

interface SelfNoteOptions {
  ref?: string;
  commit?: string;
  session?: string;
}

interface SelfNotePostResult {
  status: number;
  body: string;
}

export async function postSelfNote(args: {
  serverUrl: string;
  boxName: string;
  body: string;
  ref?: string | undefined;
  commit?: string | undefined;
  session?: string | undefined;
}): Promise<SelfNotePostResult> {
  const url = `${args.serverUrl.replace(/\/+$/, "")}/${args.boxName}/api/chat/self-note`;
  const payload: Record<string, string> = { body: args.body };
  if (args.ref) payload.ref = args.ref;
  if (args.commit) payload.commit = args.commit;
  if (args.session) payload.session = args.session;

  const res = await fetch(url, {
    method: "POST",
    headers: loopbackHeaders(),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

const selfNoteCommand = new Command("self-note")
  .description("Post an agent-authored self-note into the live chat session")
  .argument("<body>", "Note body (plain text)")
  .option("--ref <path>", "Path to the schedule/procedure card that caused this note")
  .option("--commit <hash>", "Git commit hash of the resulting work")
  .option("--session <id>", "Target session ID (defaults to live chat session)")
  .action(async (body: string, options: SelfNoteOptions) => {
    const serverUrl = process.env.CB_SERVER_URL;
    const boxName = process.env.CB_BOX_NAME;

    if (!serverUrl) {
      console.error("cb chat self-note: CB_SERVER_URL is not set");
      process.exit(1);
    }
    if (!boxName) {
      console.error("cb chat self-note: CB_BOX_NAME is not set");
      process.exit(1);
    }

    if (!body.trim()) {
      console.error("cb chat self-note: body is empty");
      process.exit(1);
    }

    try {
      const result = await postSelfNote({
        serverUrl,
        boxName,
        body,
        ref: options.ref,
        commit: options.commit,
        session: options.session,
      });

      if (result.status >= 200 && result.status < 300) {
        return;
      }

      console.error(
        `cb chat self-note: server returned ${result.status}: ${result.body}`
      );
      process.exit(1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`cb chat self-note: request failed: ${msg}`);
      process.exit(1);
    }
  });

interface WhatsChangedOptions {
  session?: string;
  card?: string;
}

async function postWhatsChanged(args: {
  serverUrl: string;
  boxName: string;
  session?: string | undefined;
  card?: string | undefined;
}): Promise<{ status: number; body: string }> {
  const url = `${args.serverUrl.replace(/\/+$/, "")}/${args.boxName}/api/chat/whats-changed`;
  const payload: Record<string, string> = {};
  if (args.session) payload.session = args.session;
  if (args.card) payload.card = args.card;

  const res = await fetch(url, {
    method: "POST",
    headers: loopbackHeaders(),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

const whatsChangedCommand = new Command("whats-changed")
  .description("Report what changed in the box since your last reply (commits since then plus the uncommitted working tree)")
  .option("--session <id>", "Target session ID (defaults to the live chat session)")
  .option("--card <path>", "Scope the report to a box-relative card path (e.g. the open companion card)")
  .action(async (options: WhatsChangedOptions) => {
    const serverUrl = process.env.CB_SERVER_URL;
    const boxName = process.env.CB_BOX_NAME;
    if (!serverUrl) {
      console.error("cb chat whats-changed: CB_SERVER_URL is not set");
      process.exit(1);
    }
    if (!boxName) {
      console.error("cb chat whats-changed: CB_BOX_NAME is not set");
      process.exit(1);
    }

    try {
      const result = await postWhatsChanged({ serverUrl, boxName, session: options.session, card: options.card });
      if (result.status >= 200 && result.status < 300) {
        const parsed: unknown = JSON.parse(result.body);
        const report = isRecord(parsed) && typeof parsed["report"] === "string" ? parsed["report"] : undefined;
        console.log(report ?? "(no report)");
        return;
      }
      console.error(`cb chat whats-changed: server returned ${result.status}: ${result.body}`);
      process.exit(1);
    } catch (e) {
      console.error(`cb chat whats-changed: request failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

interface ScreenshotOptions {
  session?: string;
  timeout?: string;
}

interface ScreenshotRequestResult {
  status: number;
  body: string;
}

async function postScreenshotRequest(args: {
  serverUrl: string;
  boxName: string;
  session: string;
  timeoutMs: number;
}): Promise<ScreenshotRequestResult> {
  const url = `${args.serverUrl.replace(/\/+$/, "")}/${args.boxName}/api/chat/screenshot/request`;
  const res = await fetch(url, {
    method: "POST",
    headers: loopbackHeaders(),
    body: JSON.stringify({ session: args.session, timeoutMs: args.timeoutMs }),
    // The long-poll runs up to `timeoutMs` server-side; give the socket ~10s of
    // headroom so the client never severs it before the server answers (a
    // client-side abort would surface as `error:`, not the real outcome).
    signal: AbortSignal.timeout(args.timeoutMs + 10_000),
  });
  return { status: res.status, body: await res.text() };
}

const screenshotCommand = new Command("screenshot")
  .description("Ask the user's connected chat tab for a screenshot of what they currently see")
  .option("--session <id>", "Target chat session ID (defaults to CB_CHAT_SESSION_ID)")
  .option("--timeout <seconds>", "How long to wait for the user to answer (default 45)")
  .action(async (options: ScreenshotOptions) => {
    const label = "cb chat screenshot";
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

    const timeoutSeconds = options.timeout !== undefined ? Number(options.timeout) : 45;
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      console.error(`${label}: invalid --timeout ${options.timeout}`);
      process.exit(1);
    }

    let result: ScreenshotRequestResult;
    try {
      result = await postScreenshotRequest({
        serverUrl,
        boxName,
        session,
        timeoutMs: Math.round(timeoutSeconds * 1000),
      });
    } catch (e) {
      // Network failure / client-side abort — report it as what it is, never
      // mislabeled as a timeout (the server-side timeout is a distinct outcome).
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch (_e) {
      console.error(`error: server returned ${result.status}: ${result.body}`);
      process.exit(1);
    }
    const bag = isRecord(parsed) ? parsed : {};

    if (result.status === 200) {
      const savedPath = typeof bag["path"] === "string" ? bag["path"] : undefined;
      const fidelity = typeof bag["fidelity"] === "string" ? bag["fidelity"] : undefined;
      if (savedPath === undefined || fidelity === undefined) {
        console.error(`error: malformed success response: ${result.body}`);
        process.exit(1);
      }
      // Path first so the agent can take line 1; metadata follows.
      console.log(savedPath);
      console.log(`fidelity: ${fidelity}`);
      if (typeof bag["capturedAt"] === "string") console.log(`captured-at: ${bag["capturedAt"]}`);
      return;
    }

    const errorCode = typeof bag["error"] === "string" ? bag["error"] : "";
    switch (errorCode) {
      case "declined":
        console.error("declined: the user declined the screenshot request");
        break;
      case "no-client":
        console.error("no-client: no browser is attached to this chat session");
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
        console.error(`error: server returned ${result.status}: ${result.body}`);
    }
    process.exit(1);
  });

export const chatCommand = new Command("chat")
  .description("Interact with the live chat session")
  .addCommand(selfNoteCommand)
  .addCommand(whatsChangedCommand)
  .addCommand(screenshotCommand)
  .addCommand(getLastAudioCommand)
  .addCommand(askAboutAudioCommand)
  .addCommand(retranscribeCommand);
