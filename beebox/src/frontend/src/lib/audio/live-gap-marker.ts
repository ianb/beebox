/**
 * The live gap marker (`docs/implemented-plans/live-gap-marker.md`): `[…]` in a
 * segment's live transcript where live transcription went offline and the
 * words spoken then are not in the live text. The HQ pass fills them in; when
 * the live text is what gets sent, the marker goes to the agent wrapped as
 * `<unsure>[…]</unsure>`.
 */

export const LIVE_GAP_MARKER = "[…]";

/**
 * Wrap every live gap marker in `<unsure>`, except one already inside an
 * `<unsure>…</unsure>` span (confidence marking can bridge over it).
 */
export function wrapLiveGapMarkers(text: string): string {
  if (!text.includes(LIVE_GAP_MARKER)) return text;
  return text.split(/(<unsure>[\S\s]*?<\/unsure>)/).map((part) =>
    part.startsWith("<unsure>") ? part : part.split(LIVE_GAP_MARKER).join(`<unsure>${LIVE_GAP_MARKER}</unsure>`),
  ).join("");
}
