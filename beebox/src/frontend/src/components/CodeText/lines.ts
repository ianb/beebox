/**
 * Split a code file into lines for the numbered view (`CodeText`). Each line
 * keeps its own line feed, so the lines joined are the source again and a copy
 * of the whole view is the file. A final line feed ends the last line rather
 * than starting an empty one, as an editor counts lines.
 */

/** Lines of plain text, each with its line feed. */
export function splitTextLines(text: string): string[] {
  const lines = text.split("\n").map((line) => `${line}\n`);
  const last = lines.length - 1;
  // The text did not end in a line feed: its last line has none.
  if (!text.endsWith("\n")) lines[last] = lines[last]?.slice(0, -1) ?? "";
  else lines.pop();
  return lines;
}

const TAG = /<span\b[^>]*>|<\/span>/g;

/**
 * Lines of highlight.js markup, each balanced: a span open at a line feed (a
 * multi-line comment or string) closes at the end of that line and opens again
 * at the start of the next. highlight.js emits only `<span class="…">` and
 * `</span>` as markup; every other `<` is escaped.
 */
export function splitHtmlLines(html: string): string[] {
  const open: string[] = [];
  // A span open at the end of the file (an unclosed comment) closes after the
  // final line feed; moved before it, so it adds no empty line.
  const closed = html.replace(/\n((?:<\/span>)+)$/, "$1\n");
  return splitTextLines(closed).map((line) => {
    const prefix = open.join("");
    for (const [tag] of line.matchAll(TAG)) {
      if (tag === "</span>") open.pop();
      else open.push(tag);
    }
    return prefix + line + "</span>".repeat(open.length);
  });
}

/** Tabs render this wide (`tab-size` on `.bbx-code`), so indents are counted the same. */
export const TAB_SIZE = 4;

/** The width of a line's leading whitespace, in characters. */
export function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += TAB_SIZE - (width % TAB_SIZE);
    else break;
  }
  return width;
}
