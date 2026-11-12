/**
 * `bbx chat strip set <card>` and `bbx chat strip clear` — put a card in the
 * conversation's strip across the top of the person's page, or take it out
 * (`docs/plans/conversation-strip.md`). The server checks that the card
 * exists and has a strip rendering; a refusal prints its message and exits 1.
 */

import { Command } from "commander";

import { isRecord } from "../../../shared/is-record.js";
import { resolveChatSessionId } from "../../../core/chat/session/id-file.js";
import { loopbackHeaders } from "../../lib/loopback-headers.js";

interface StripOptions {
  session?: string;
}

async function postStrip(label: string, request: { card: string | null; options: StripOptions }): Promise<void> {
  const { card, options } = request;
  const serverUrl = process.env.BBX_SERVER_URL;
  const boxName = process.env.BBX_BOX_NAME;
  if (!serverUrl) {
    console.error(`${label}: BBX_SERVER_URL is not set`);
    process.exit(1);
  }
  if (!boxName) {
    console.error(`${label}: BBX_BOX_NAME is not set`);
    process.exit(1);
  }
  const session = options.session ?? (await resolveChatSessionId());
  if (!session) {
    console.error(`${label}: no session — pass --session <id> or run inside a chat session (BBX_CHAT_SESSION_ID)`);
    process.exit(1);
  }

  let status: number;
  let text: string;
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/${boxName}/api/chat/strip`, {
      method: "POST",
      headers: loopbackHeaders(),
      body: JSON.stringify({ session, card }),
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    console.error(`error: server returned ${status}: ${text}`);
    process.exit(1);
  }
  const bag = isRecord(parsed) ? parsed : {};
  if (status === 200 && typeof bag["strip"] === "string") {
    console.log(`strip: ${bag["strip"]}`);
    return;
  }
  const message = typeof bag["message"] === "string" ? bag["message"] : `server returned ${status}: ${text}`;
  console.error(message);
  process.exit(1);
}

const setCommand = new Command("set")
  .description("Show a card in the strip across the top of the person's page (tour cards, and box views that list \"strip\" in modes)")
  .argument("<card>", "Box path of the card, e.g. /_content/Walk-through.tour.card")
  .option("--session <id>", "Target chat session ID (defaults to BBX_CHAT_SESSION_ID)")
  .action(async (card: string, options: StripOptions) => {
    await postStrip("bbx chat strip set", { card, options });
  });

const clearCommand = new Command("clear")
  .description("Remove the card from the strip")
  .option("--session <id>", "Target chat session ID (defaults to BBX_CHAT_SESSION_ID)")
  .action(async (options: StripOptions) => {
    await postStrip("bbx chat strip clear", { card: null, options });
  });

export const stripCommand = new Command("strip")
  .description("Show or clear the conversation strip")
  .addCommand(setCommand)
  .addCommand(clearCommand);
