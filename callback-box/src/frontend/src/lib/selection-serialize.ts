/**
 * Serialize composer selections into a message body. The single function
 * every send path calls, so a selection folds into a typed message and a
 * spoken one identically:
 *
 *  - `[selectionN]` tokens in the body are replaced inline with a
 *    `<user-selection>` element (typed messages carry tokens, so this
 *    dominates there).
 *  - Any selection whose token is absent from the body is appended after it
 *    (spoken messages have no tokens, so every selection appends).
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

export function applySelections(body: string, opts: { selections: SelectionItem[] }): string {
  const { selections } = opts;
  if (selections.length === 0) {
    return body;
  }
  const used = new Set<number>();
  const replaced = body.replace(/\[selection(\d+)]/g, (match, digits: string) => {
    const id = parseInt(digits, 10);
    const selection = selections.find((s) => s.id === id);
    if (selection === undefined) {
      // Unknown token (e.g. hand-typed) — leave it as literal text.
      return match;
    }
    used.add(id);
    return renderSelection(selection);
  });
  const orphans = selections.filter((s) => !used.has(s.id));
  if (orphans.length === 0) {
    return replaced;
  }
  const appended = orphans.map(renderSelection).join("\n");
  return replaced === "" ? appended : `${replaced}\n${appended}`;
}
