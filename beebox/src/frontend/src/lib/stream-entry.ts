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
 * Tools come first, then the text block — matching the streaming layout (text
 * with tools above it). Content may be empty; callers that shouldn't synthesize
 * an empty entry guard on that themselves.
 */

import type { SessionEntry, SessionContentBlock } from "../api";

export function buildStreamEntry(opts: { uuid: string; streamText: string; streamTools: SessionContentBlock[] }): SessionEntry {
  const { uuid, streamText, streamTools } = opts;
  const content: SessionContentBlock[] = [...streamTools];
  if (streamText) content.push({ type: "text", text: streamText });
  return {
    uuid,
    type: "assistant",
    timestamp: new Date().toISOString(),
    content,
  };
}
