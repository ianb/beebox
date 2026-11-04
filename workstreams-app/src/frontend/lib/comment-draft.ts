import { isElementFragment, type SelectionAnchor } from "./selection-anchor.js";

/** Put the picked context where typing and dictation already happen. */
export function commentDraftText(anchor: SelectionAnchor | null): string {
  if (anchor === null) return "";
  const text = anchor.fragment !== undefined && isElementFragment(anchor.fragment) && anchor.quoted.length > 220
    ? `${anchor.quoted.slice(0, 220)}…`
    : anchor.quoted;
  return `${text.split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
}

/** The original anchor remains separate from the editable draft for markers. */
export function commentBody(text: string, anchor: SelectionAnchor | null): string {
  const prefix = commentDraftText(anchor).trimEnd();
  if (prefix !== "" && text.startsWith(prefix)) {
    const rest = text.slice(prefix.length);
    if (rest === "" || rest.startsWith("\n")) return rest.trim();
  }
  return text.trim();
}

/** A transcript follows the quote block, rather than joining its last line. */
export function appendCommentTranscript(current: string, transcript: string): string {
  const addition = transcript.trim();
  if (addition === "") return current;
  if (current.endsWith("\n")) return `${current}${addition}`;
  return current.trim() === "" ? addition : `${current.trimEnd()} ${addition}`;
}
