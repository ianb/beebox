/**
 * Serialize composer selections into a message body. The single function
 * every send path calls, so a selection folds into a typed message and a
 * spoken one identically:
 *
 *  - `[selectionN]` tokens in the body are replaced inline with a
 *    `<user-selection>` element (typed messages carry tokens, so this
 *    dominates there).
 *  - A selection with no token but a voice `anchor` (the words spoken just
 *    before it was grabbed) is inserted after that phrase's occurrence in the
 *    body — positional placement for spoken messages, which have no caret.
 *    Anchor matching is word-level and case/punctuation-insensitive so it
 *    survives the HQ re-transcription that rewrites the text. An empty anchor
 *    places the selection at the start; an anchor that can't be found falls
 *    back to appending at the end.
 *  - Anything left over is appended after the body.
 *
 * Pure (string in, string out) so it's unit tested; the voice and typed send
 * paths both route through it.
 */

export interface SelectionItem {
  id: number;
  /** Box-relative source path, absolute (leading "/"). */
  ref: string;
  /** Verbatim rendered text of the selection. */
  text: string;
  /** Freeform locator (see selection-position.ts); may be "". */
  position: string;
  /**
   * Voice positional anchor: the transcript words spoken just before the
   * selection was grabbed. The serializer inserts the selection after this
   * phrase in the spoken body. `null`/absent means token-based (typed) or
   * plain append; `""` means "place at the start".
   */
  anchor?: string | null;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderSelection(selection: SelectionItem): string {
  const positionAttr = selection.position === "" ? "" : ` position="${escapeAttr(selection.position)}"`;
  return `<user-selection ref="${escapeAttr(selection.ref)}"${positionAttr}>${escapeText(selection.text)}</user-selection>`;
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\da-z]/g, "");
}

/** Last `count` words of `text` — the voice positional anchor captured at grab time. */
export function lastWords(text: string, count: number): string {
  const words = text.trim().split(/\s+/).filter((word) => word !== "");
  return words.slice(-count).join(" ");
}

/**
 * Char offset just after the last occurrence of `anchor`'s word sequence in
 * `body`, comparing words case/punctuation-insensitively (so it tolerates the
 * HQ pass repunctuating/recasing). Returns null when the phrase isn't found.
 */
function findAnchorEnd(body: string, anchor: string): number | null {
  const anchorWords = anchor.split(/\s+/).map(normalizeWord).filter((word) => word !== "");
  if (anchorWords.length === 0) {
    return null;
  }
  const tokens: Array<{ norm: string; end: number }> = [];
  const wordRe = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(body)) !== null) {
    const norm = normalizeWord(match[0]);
    if (norm !== "") {
      tokens.push({ norm, end: match.index + match[0].length });
    }
  }
  for (let i = tokens.length - anchorWords.length; i >= 0; i -= 1) {
    const matched = anchorWords.every((word, j) => tokens[i + j].norm === word);
    if (matched) {
      return tokens[i + anchorWords.length - 1].end;
    }
  }
  return null;
}

function insertAt(body: string, opts: { pos: number; fragment: string }): string {
  const { pos, fragment } = opts;
  const before = body.slice(0, pos);
  const after = body.slice(pos);
  const padBefore = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const padAfter = after.length > 0 && !/^\s/.test(after) ? " " : "";
  return before + padBefore + fragment + padAfter + after;
}

export function applySelections(body: string, opts: { selections: SelectionItem[] }): string {
  const { selections } = opts;
  if (selections.length === 0) {
    return body;
  }
  const used = new Set<number>();
  let result = body.replace(/\[selection(\d+)]/g, (match, digits: string) => {
    const id = parseInt(digits, 10);
    const selection = selections.find((s) => s.id === id);
    if (selection === undefined) {
      // Unknown token (e.g. hand-typed) — leave it as literal text.
      return match;
    }
    used.add(id);
    return renderSelection(selection);
  });

  // Selections with no inline token: place anchored ones (voice) by their
  // phrase; everything else appends.
  const inserts: Array<{ pos: number; selection: SelectionItem }> = [];
  const appendList: SelectionItem[] = [];
  for (const selection of selections) {
    if (used.has(selection.id)) {
      continue;
    }
    const anchor = selection.anchor;
    if (anchor === undefined || anchor === null) {
      appendList.push(selection);
      continue;
    }
    const pos = anchor === "" ? 0 : findAnchorEnd(result, anchor);
    if (pos === null) {
      appendList.push(selection);
    } else {
      inserts.push({ pos, selection });
    }
  }
  // Apply right-to-left so the earlier insertion points stay valid.
  inserts.sort((a, b) => b.pos - a.pos);
  for (const { pos, selection } of inserts) {
    result = insertAt(result, { pos, fragment: renderSelection(selection) });
  }
  if (appendList.length > 0) {
    const appended = appendList.map(renderSelection).join("\n");
    result = result === "" ? appended : `${result}\n${appended}`;
  }
  return result;
}
