/**
 * cb chat - Commands that interact with the live chat session.
 *
 * - `cb chat self-note` posts an agent-authored note into the chat session
 *   transcript without triggering a conversational response.
 * - `cb chat get-last-audio` fetches the original recording of the user's
 *   most recent voice message from the connected browser tab and writes it
 *   to a temp file (the browser caches the last segment's WAV; the server
 *   relays the request over the event bus — see chat-last-audio-routes.ts).
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { resolveAgentToken } from "../../core/agent-token.js";

/**
 * Request headers for loopback calls to the live server: JSON content type
 * plus the per-box agent bearer when available (required to pass the auth
 * wall in production; harmless when auth is disabled in dev).
 */
function loopbackHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = resolveAgentToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

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

interface GetLastAudioOptions {
  out?: string;
  timeout?: string;
}

/** File extension for the audio Content-Type the browser sent. */
function audioExtension(contentType: string): string {
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("mp4")) return "m4a";
  return "bin";
}

const getLastAudioCommand = new Command("get-last-audio")
  .description("Fetch the recording of the user's most recent voice message from the connected chat tab")
  .option("--out <path>", "Write the audio to this path (default: a fresh temp file)")
  .option("--timeout <seconds>", "How long to wait for a browser tab to answer (default 10)")
  .action(async (options: GetLastAudioOptions) => {
    const serverUrl = process.env.CB_SERVER_URL;
    const boxName = process.env.CB_BOX_NAME;
    if (!serverUrl || !boxName) {
      console.error("cb chat get-last-audio: CB_SERVER_URL and CB_BOX_NAME must be set");
      process.exit(1);
    }

    const timeoutSeconds = options.timeout !== undefined ? Number(options.timeout) : 10;
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      console.error(`cb chat get-last-audio: invalid --timeout ${options.timeout}`);
      process.exit(1);
    }

    const url = `${serverUrl.replace(/\/+$/, "")}/${boxName}/api/chat/last-audio/request`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: loopbackHeaders(),
        body: JSON.stringify({ timeoutMs: Math.round(timeoutSeconds * 1000) }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`cb chat get-last-audio: request failed: ${msg}`);
      process.exit(1);
    }

    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed !== null && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") {
          message = parsed.message;
        }
      } catch (_e) {
        // Not JSON — report the raw body.
      }
      console.error(`cb chat get-last-audio: ${message} (HTTP ${res.status})`);
      process.exit(1);
    }

    const audio = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "";
    let outPath: string;
    if (options.out !== undefined) {
      outPath = path.resolve(options.out);
    } else {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-last-audio-"));
      outPath = path.join(dir, `last-message.${audioExtension(contentType)}`);
    }
    await fs.writeFile(outPath, audio);

    // Path first so callers can take line 1; metadata lines identify which
    // message the recording belongs to.
    console.log(outPath);
    const recordedAt = res.headers.get("x-recorded-at");
    if (recordedAt !== null) console.log(`recorded-at: ${recordedAt}`);
    const text = res.headers.get("x-message-text");
    if (text !== null) console.log(`text: ${decodeURIComponent(text)}`);
  });

export const chatCommand = new Command("chat")
  .description("Interact with the live chat session")
  .addCommand(selfNoteCommand)
  .addCommand(getLastAudioCommand);
