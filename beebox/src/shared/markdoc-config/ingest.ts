/**
 * Make outside text safe to store in a card body.
 *
 * Card bodies render raw HTML through an allow-list and run Markdoc tags.
 * Content a connector brings in from outside (a clipped web page, a PDF's
 * extracted text, a form submission) should do neither: it has no business
 * producing box tags, and allow-listed HTML can still dress third-party text
 * up as box UI. These helpers escape that syntax at write time, so the stored
 * body renders as the literal text the source contained, and an agent reading
 * the file sees the same thing the boxholder does. An agent that later edits
 * the card can add real tags or HTML; that edit is the deliberate step.
 */

/** CommonMark autolinks (`<https://…>`, `<a@b.c>`): Markdown, not HTML, so left alone. */
const AUTOLINK = /^<(?:[A-Za-z][\d+.A-Za-z-]{1,31}:[^\s<>]*|[\w!#$%&'*+./=?^`{|}~-]+@[\dA-Za-z](?:[\dA-Za-z-]*[\dA-Za-z])?(?:\.[\dA-Za-z](?:[\dA-Za-z-]*[\dA-Za-z])?)*)>/;

/** A `<` that could open raw HTML: a tag, a close tag, a comment, a declaration or a processing instruction. */
const HTML_START = /^<[!/?A-Za-z]/;

/** A fence opener or closer: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Escape the HTML openers and Markdoc tag openers in one run of non-fenced text, skipping code spans. */
function neutralizeText(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(text.slice(i))?.[0] ?? "`";
      const close = text.indexOf(run, i + run.length);
      const end = close === -1 ? i + run.length : close + run.length;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    const rest = text.slice(i);
    if (c === "{" && text[i + 1] === "%") out += "\\";
    else if (c === "<" && HTML_START.test(rest) && !AUTOLINK.test(rest)) out += "\\";
    out += c;
    i += 1;
  }
  return out;
}

/**
 * A fenced block, copied unchanged except for its opener. Markdoc runs tags
 * inside fences, so a template language's `{% if %}` would otherwise become a
 * box tag (or swallow the rest of the document). The opener loses any Markdoc
 * annotation the outside text carried (Markdoc obeys only the first one, so a
 * `{% process=true %}` there would win) and gains `{% process=false %}` when
 * the content holds `{%`.
 */
function fencedBlock(lines: string[]): string[] {
  const [rawOpener, ...rest] = lines;
  if (rawOpener === undefined) return lines;
  const opener = rawOpener.replaceAll(/{%[\S\s]*?%}/g, "").trimEnd();
  return [rest.some((line) => line.includes("{%")) ? `${opener} {% process=false %}` : opener, ...rest];
}

/**
 * Escape raw HTML (tags, comments, declarations) and Markdoc tag openers
 * (`{%`) outside code, leaving all other Markdown structure intact. Inline
 * code spans are copied unchanged; fenced code is copied unchanged apart from
 * the opener annotation `fencedBlock` adds. Idempotent.
 */
export function neutralizeIngestedMarkdown(markdown: string): string {
  const out: string[] = [];
  let text: string[] = [];
  let fence: { marker: string; lines: string[] } | null = null;
  for (const line of markdown.split("\n")) {
    const marker = FENCE.exec(line)?.[1];
    if (fence === null) {
      if (marker === undefined) {
        text.push(line);
        continue;
      }
      if (text.length > 0) out.push(neutralizeText(text.join("\n")));
      text = [];
      fence = { marker, lines: [line] };
      continue;
    }
    fence.lines.push(line);
    const closes = marker !== undefined && marker[0] === fence.marker[0] && marker.length >= fence.marker.length && line.trim() === marker;
    if (closes) {
      out.push(...fencedBlock(fence.lines));
      fence = null;
    }
  }
  if (fence !== null) out.push(...fencedBlock(fence.lines));
  if (text.length > 0) out.push(neutralizeText(text.join("\n")));
  return out.join("\n");
}

/** Every ASCII punctuation character: CommonMark lets each be backslash-escaped. */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/g;

/**
 * Escape an untrusted value as plain text for a Markdown body: every ASCII
 * punctuation character gets a backslash, so no Markdown, HTML, link or
 * Markdoc syntax survives. Line breaks become hard breaks, indented by
 * `indent` so the text stays inside an enclosing list item.
 */
export function escapeMarkdownText(value: string, { indent }: { indent: string }): string {
  return value
    .replaceAll(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replaceAll(ASCII_PUNCTUATION, (ch) => `\\${ch}`))
    .join(`\\\n${indent}`);
}
