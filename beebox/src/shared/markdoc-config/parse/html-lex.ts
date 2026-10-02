/**
 * Split an HTML fragment from markdown-it (`html_inline` / `html_block`
 * content) into tags, comments and text. The tag grammar follows CommonMark's
 * raw-HTML definition, the same one markdown-it used to recognize the
 * fragment. Lexing errors cannot cause unsafe output: `html-tokens.ts` only
 * emits allow-listed elements, and everything else becomes literal text.
 */

const ATTR_NAME = "[A-Za-z_:][\\w.:-]*";
const UNQUOTED = "[^\"'=<>`\\u0000-\\u0020]+";
const ATTR_VALUE = `(?:${UNQUOTED}|'[^']*'|"[^"]*")`;
const ATTRIBUTE = `(?:\\s+${ATTR_NAME}(?:\\s*=\\s*${ATTR_VALUE})?)`;
const OPEN_TAG = `<([A-Za-z][\\dA-Za-z-]*)(${ATTRIBUTE}*)\\s*(\\/?)>`;
const CLOSE_TAG = "<\\/([A-Za-z][\\dA-Za-z-]*)\\s*>";
const COMMENT = "<!--[\\s\\S]*?-->";
const OTHER = "<\\?[\\s\\S]*?\\?>|<![A-Za-z]+\\s+[^>]*>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";

/** A fresh `/g` regex per call: a shared one carries `lastIndex` between callers. */
function htmlPiecePattern(): RegExp {
  return new RegExp(`(${COMMENT})|${OPEN_TAG}|${CLOSE_TAG}|(${OTHER})`, "g");
}

function attributePattern(): RegExp {
  return new RegExp(`\\s+(${ATTR_NAME})(?:\\s*=\\s*(?:(${UNQUOTED})|'([^']*)'|"([^"]*)"))?`, "g");
}

export type HtmlPiece =
  | { kind: "text"; src: string }
  | { kind: "comment" }
  | { kind: "other"; src: string }
  | { kind: "open"; src: string; name: string; attributes: [string, string | true][]; selfClosing: boolean }
  | { kind: "close"; src: string; name: string };

function parseAttributes(src: string, decode: (s: string) => string): [string, string | true][] {
  const out: [string, string | true][] = [];
  for (const m of src.matchAll(attributePattern())) {
    const name = m[1];
    if (name === undefined) continue;
    const raw = m[2] ?? m[3] ?? m[4];
    out.push([name, raw === undefined ? true : decode(raw)]);
  }
  return out;
}

/** Split an HTML fragment into tags, comments and the text between them. */
export function lexHtml(src: string, decode: (s: string) => string): HtmlPiece[] {
  const pieces: HtmlPiece[] = [];
  let at = 0;
  for (const m of src.matchAll(htmlPiecePattern())) {
    if (m.index > at) pieces.push({ kind: "text", src: src.slice(at, m.index) });
    at = m.index + m[0].length;
    if (m[1] !== undefined) pieces.push({ kind: "comment" });
    else if (m[2] !== undefined) {
      pieces.push({
        kind: "open",
        src: m[0],
        name: m[2].toLowerCase(),
        attributes: parseAttributes(m[3] ?? "", decode),
        selfClosing: m[4] === "/",
      });
    } else if (m[5] !== undefined) pieces.push({ kind: "close", src: m[0], name: m[5].toLowerCase() });
    else pieces.push({ kind: "other", src: m[0] });
  }
  if (at < src.length) pieces.push({ kind: "text", src: src.slice(at) });
  return pieces;
}

export type OpenPiece = HtmlPiece & { kind: "open" };

/** An attribute's value by case-insensitive name. */
export function attribute(piece: OpenPiece, name: string): string | true | undefined {
  return piece.attributes.find(([n]) => n.toLowerCase() === name)?.[1];
}

/** Authored attribute names outside `kept` (lowercase names). */
export function droppedAttributes(piece: OpenPiece, kept: readonly string[]): string[] {
  return piece.attributes.map(([n]) => n).filter((n) => !kept.includes(n.toLowerCase()));
}

/** The validation message for attributes dropped from `element`, or `undefined` when none were. */
export function droppedMessage(element: string, dropped: readonly string[]): string | undefined {
  if (dropped.length === 0) return undefined;
  return `<${element}>: attribute${dropped.length > 1 ? "s" : ""} ${dropped.join(", ")} not supported; dropped`;
}

/** A validation warning Markdoc attaches to the node built from a token (it reads `token.errors`). */
export interface HtmlWarning {
  id: string;
  level: "warning";
  message: string;
}

export function warning(message: string): HtmlWarning {
  return { id: "html-unsupported", level: "warning", message };
}
