/**
 * `bbx chat activity [--card <path>] [--json]` — what the person did in views
 * and figures since your last reply: the window for your own chat session
 * (`BBX_CHAT_SESSION_ID`), oldest first. `whats-changed` lists file changes;
 * this lists actions. Reads `.beebox/activity.jsonl` and its rotated file
 * directly (core/activity/).
 */

import { Command } from "commander";

import { activityWindow } from "../../../core/activity/cursor.js";
import type { ActivityLine } from "../../../core/activity/entry.js";
import { resolveChatSessionId } from "../../../core/chat/session/id-file.js";
import { requireBoxRoot } from "../../../lib/paths/core.js";

/** A new chat's first turn binds its cursor just after the session id is assigned; wait this long for it. */
const BIND_WAIT_MS = 2000;
const EMPTY = "No activity since your last reply.";
const NOT_LINKED = "No activity found for this chat. If this is a new chat's first reply, its activity may not be linked yet: run the command again in a moment.";

interface ActivityOptions {
  card?: string;
  json?: boolean;
}

function clock(at: string): string {
  const d = new Date(at);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/**
 * One line per entry: `HH:MM:SS  card  kind  detail  {activity json}`, marking entries after the turn's message.
 * The time is when the page saw the action (`clientAt`), since a batch shares one server time. An entry
 * appended after the turn's send has a `seq` above the cursor's `hinted`; times can tie to the millisecond.
 * With no cursor yet (a new chat's first turn whose binding has not landed), an empty window says so.
 */
export function renderActivityText(lines: readonly ActivityLine[], opts: { hinted: number | undefined }): string {
  if (lines.length === 0) return opts.hinted === undefined ? NOT_LINKED : EMPTY;
  return lines.map((line) => {
    const seen = line.clientAt !== undefined && !Number.isNaN(Date.parse(line.clientAt)) ? line.clientAt : line.at;
    const parts = [clock(seen), line.card, line.kind];
    if (line.detail !== undefined) parts.push(line.detail);
    if (line.activity !== undefined) parts.push(JSON.stringify(line.activity));
    if (opts.hinted !== undefined && line.seq > opts.hinted) parts.push("(after your message)");
    return parts.join("  ");
  }).join("\n");
}

export const activityCommand = new Command("activity")
  .description("List what the person did in views and figures since your last reply (whats-changed is files; this is actions)")
  .option("--card <path>", "Only this card's activity (a box-relative path)")
  .option("--json", "Print the raw JSON lines")
  .action(async (options: ActivityOptions) => {
    const sessionId = await resolveChatSessionId();
    if (sessionId === null) {
      console.error("bbx chat activity: no chat session — run inside a chat session (BBX_CHAT_SESSION_ID)");
      process.exit(1);
    }
    const boxRoot = await requireBoxRoot();
    const { cursor, entries } = await activityWindow(boxRoot, {
      sessionId,
      bindWaitMs: BIND_WAIT_MS,
      ...(options.card !== undefined ? { card: options.card } : {}),
    });
    if (options.json === true) {
      for (const entry of entries) console.log(JSON.stringify(entry));
      return;
    }
    console.log(renderActivityText(entries, { hinted: cursor?.hinted }));
  });
