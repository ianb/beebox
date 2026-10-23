/**
 * Grouping of one assistant turn's blocks into what the chat renders: reply
 * text, activity groups (thinking, tool calls, folded notes), and visible
 * progress updates.
 */

import type { SessionEntry, SessionContentBlock } from "../../api";
import { parseCallouts, stripStructuredOutputTags } from "../../lib/structured-output-parsing";
import { stripSpeechTags } from "./message-parsing";

// A discriminated union on `type`: text/thinking parts carry `text`, a tools
// part carries `tools`. Each variant holds exactly the field its kind
// populates, so a consumer that narrows on `type` sees only the fields that
// exist — no optional-field guards or runtime `invariant`s needed.
type AssistantPart =
  | { type: "text"; text: string }
  | { type: "update"; text: string }
  | { type: "thinking"; text?: string }
  | { type: "tools"; tools: SessionContentBlock[] };
/**
 * Reply text. `proseHidden`: its prose folded into the activity row as a note,
 * and only its callouts render here.
 */
export interface TextGroup { kind: "text"; text: string; proseHidden?: true }
/** A progress update: a line the model wrote for the user before a tool call. */
export interface UpdateGroup { kind: "update"; text: string }
/** What an activity group renders: thinking, tool calls, and folded notes. */
export type ActivityPart =
  | { type: "thinking"; text?: string }
  | { type: "tools"; tools: SessionContentBlock[] }
  | { type: "note"; text: string };
export interface ActivityGroupData { kind: "activity"; parts: ActivityPart[] }
type AssistantGroup = TextGroup | UpdateGroup | ActivityGroupData;

/** Whether text shows anything once tags are stripped: prose or a callout. */
function hasVisibleText(text: string): boolean {
  return stripStructuredOutputTags(stripSpeechTags(text)).trim().length > 0 || parseCallouts(text).length > 0;
}

function flattenParts(entries: SessionEntry[]): AssistantPart[] {
  const flat: AssistantPart[] = [];
  for (const entry of entries) {
    for (const block of entry.content) {
      if (block.type === "thinking" && block.progressUpdate === true && block.text?.trim()) {
        flat.push({ type: "update", text: block.text.trim() });
      } else if (block.type === "thinking" && block.text?.trim()) {
        flat.push({ type: "thinking", text: block.text });
      } else if (block.type === "text" && block.text?.trim()) {
        flat.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        // `.at(-1)`: see the note in `groupMessages` (message-parsing.ts).
        const last = flat.at(-1);
        if (last && last.type === "tools") {
          last.tools.push(block);
        } else {
          flat.push({ type: "tools", tools: [block] });
        }
      }
    }
  }
  return flat;
}

/**
 * Group an assistant turn into text, activity groups (thinking, tools, notes),
 * and visible progress updates.
 *
 * With `fold` (the default), lines written between steps fold into the activity
 * row as notes: progress updates, and text written before a later tool call.
 * The reply is the text after the last tool call. The same rule holds while
 * the turn streams, so the newest line shows until the next step folds it.
 * Exceptions keep things the person must see:
 *  - text with a `<speech>` tag stays as written;
 *  - a folded text's callouts still render in place;
 *  - when the turn has no visible reply (none yet, or a bare `<ack>`), the
 *    last line stays visible: a model sometimes puts its whole answer there.
 * Without `fold` (the debug view), updates and text render in order as written.
 */
export function groupIntoParts(entries: SessionEntry[], opts?: { fold: boolean }): AssistantGroup[] {
  const fold = opts?.fold !== false;
  const flat = flattenParts(entries);
  const lastTools = flat.findLastIndex((part) => part.type === "tools");
  const replyShown = flat.some((part, i) => i > lastTools && part.type === "text" && hasVisibleText(part.text));
  // A line that may fold: an update anywhere, or text before the last tool call.
  const foldable = (part: AssistantPart, i: number): boolean =>
    part.type === "update" || (part.type === "text" && i < lastTools && !/<speech[\s>]/i.test(part.text));
  const keptLine = replyShown ? -1 : flat.findLastIndex(foldable);

  const grouped: AssistantGroup[] = [];
  let activityBuf: ActivityPart[] = [];
  function flushActivity() {
    if (activityBuf.length > 0) {
      grouped.push({ kind: "activity", parts: activityBuf });
      activityBuf = [];
    }
  }

  for (const [i, part] of flat.entries()) {
    if (part.type === "thinking" || part.type === "tools") {
      activityBuf.push(part);
    } else if (fold && i !== keptLine && foldable(part, i)) {
      // Callouts render before the note, so the note stays with its step.
      if (part.type === "text" && parseCallouts(part.text).length > 0) {
        flushActivity();
        grouped.push({ kind: "text", text: part.text, proseHidden: true });
      }
      const note = part.type === "update" ? part.text : stripStructuredOutputTags(stripSpeechTags(part.text)).trim();
      if (note) activityBuf.push({ type: "note", text: note });
    } else {
      flushActivity();
      grouped.push({ kind: part.type, text: part.text });
    }
  }
  flushActivity();

  return grouped;
}

/** Whether an assistant group will produce visible message content. */
export function hasRenderableAssistantContent(entries: SessionEntry[], debugView?: boolean): boolean {
  return groupIntoParts(entries, { fold: debugView !== true }).some((part) => {
    if (part.kind !== "text") return true;
    if (debugView) return true;
    return hasVisibleText(part.text);
  });
}

/**
 * Whether any entry carries a progress update. An update is written for the
 * user, so a turn that has one stays visible even when its only text is a
 * `no-response` ack.
 */
export function hasProgressUpdate(entries: SessionEntry[]): boolean {
  return entries.some((e) => e.content.some((b) => b.progressUpdate === true && Boolean(b.text?.trim())));
}
