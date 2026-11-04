import type { SelectionAnchor } from "./selection-anchor.js";

/** Put the picked context where typing and dictation already happen. */
export function commentDraftText(anchor: SelectionAnchor | null): string {
  if (anchor === null) return "";
  return `${anchor.quoted.split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
}

/** The original anchor remains separate from the editable draft for markers. */
export function commentBody(text: string, anchor: SelectionAnchor | null): string {
  const prefix = commentDraftText(anchor);
  return (prefix !== "" && text.startsWith(prefix) ? text.slice(prefix.length) : text).trim();
}

/** A transcript follows the quote block, rather than joining its last line. */
export function appendCommentTranscript(current: string, transcript: string): string {
  const addition = transcript.trim();
  if (addition === "") return current;
  if (current.endsWith("\n\n")) return `${current}${addition}`;
  return current.trim() === "" ? addition : `${current.trimEnd()} ${addition}`;
}
