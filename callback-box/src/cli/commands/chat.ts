/**
 * cb chat - Commands that interact with the live chat session.
 *
 * - `cb chat self-note` posts an agent-authored note into the chat session
 *   transcript without triggering a conversational response.
 * - `cb chat get-last-audio` / `cb chat ask-about-audio` work with the
 *   recording of the user's most recent voice message — see chat-audio.ts.
 */

import { Command } from "commander";
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

export const chatCommand = new Command("chat")
  .description("Interact with the live chat session")
  .addCommand(selfNoteCommand)
  .addCommand(getLastAudioCommand)
  .addCommand(askAboutAudioCommand)
  .addCommand(retranscribeCommand);
