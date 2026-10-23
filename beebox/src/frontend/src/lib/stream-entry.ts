/**
 * Build an assistant `SessionEntry` from the in-flight stream buffers
 * (`streamText` + `streamTools`). Used in two places that must agree on shape:
 *
 *  - the live message list renders a *provisional* assistant group from this
 *    while a turn streams, so the streamed and finalized turn are one component
 *    (see InteractiveChat-message-items `buildDataItems`), and
 *  - the chat machine rolls the buffers into a synthetic entry on the "new"
 *    session finalize path (`rollupStreamToEntry`).
 *
 * Each tool block carries `streamTextOffset`, the length of `streamText` when it
 * arrived; the text before that offset goes ahead of the tool, as in the stored
 * transcript. A block without an offset counts as offset 0 (tools first). The
 * text may be shorter than an offset (the list trims it to a safe boundary).
 * Content may be empty; callers that shouldn't synthesize an empty entry guard
 * on that themselves.
 */

import type { SessionEntry, SessionContentBlock } from "../api";
import { boxNow } from "./box-clock";

export function buildStreamEntry(opts: { uuid: string; streamText: string; streamTools: SessionContentBlock[] }): SessionEntry {
  const { uuid, streamText, streamTools } = opts;
  const content: SessionContentBlock[] = [];
  let at = 0;
  function pushText(end: number) {
    const slice = streamText.slice(at, end);
    if (slice.trim()) content.push({ type: "text", text: slice });
    at = Math.max(at, Math.min(end, streamText.length));
  }
  for (const { streamTextOffset, ...tool } of streamTools) {
    pushText(streamTextOffset ?? 0);
    content.push(tool);
  }
  pushText(streamText.length);
  return {
    uuid,
    type: "assistant",
    timestamp: new Date(boxNow()).toISOString(),
    content,
  };
}
