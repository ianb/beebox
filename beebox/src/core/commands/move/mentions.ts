/**
 * `bbx mv` path mentions in `.md` files.
 *
 * The link rewriter only touches ref-bearing syntax (markdown links, `ref=`
 * attributes, frontmatter). A path written as plain text or inside a code span
 * (`` `../Foo.type.card` ``) in an `AGENTS.md` or a dossier goes stale on a move
 * just the same. This pass scans the whole `.md` text, fenced code included
 * (a doc example naming a moved card should stay truthful), for path tokens
 * that resolve exactly to a moved target and restyles them: relative stays
 * relative, `/_content/…` and bare `_content/…` stay box-absolute.
 *
 * A token is a maximal run of path characters, so a longer path that merely
 * contains the old one never matches. Resolution goes through the shared ref
 * algebra via {@link transformForReferrer}. Not a `.ts` concern: code is not
 * scanned. A path with a space is not recognized: card filenames cannot
 * contain one (card lint), but a file in a card's `.attach/` folder can.
 */

import * as path from "node:path";
import { transformForReferrer, type Remap } from "../../rewrite-card-refs/core.js";

// A maximal run of characters that can appear in a ref path. Quotes, brackets,
// parentheses, `=` and whitespace end a token. `:` stays inside, so a value
// like `urn:Foo.doc.card` or a URL is one token that resolves to nothing.
const PATH_TOKEN = /[^\s!"'()*,;<=>?[\\\]`{|}]+/g;

/** Trailing sentence punctuation is not part of the path. */
const TRAILING = /[#.:]+$/;

/**
 * Rewrite path mentions in a `.md` file that resolve to a moved target.
 * `absoluteOnly` skips file-relative tokens, for a file that itself moved
 * (its relative paths are resolved from a different location than it holds).
 */
function rewriteMentions(params: {
  boxRoot: string;
  fileAbs: string;
  text: string;
  remap: Remap;
  absoluteOnly: boolean;
}): { text: string; count: number } {
  const { boxRoot, fileAbs, remap, absoluteOnly } = params;
  const transform = transformForReferrer({ boxRoot, cardAbsPath: fileAbs, remap });
  let count = 0;
  const text = params.text.replace(PATH_TOKEN, (token) => {
    const trailing = TRAILING.exec(token)?.[0] ?? "";
    let core = token.slice(0, token.length - trailing.length);
    const slash = core.length > 1 && core.endsWith("/") ? "/" : "";
    if (slash !== "") core = core.slice(0, -1);
    const next = rewriteToken({ core, transform, absoluteOnly });
    if (next === core) return token;
    count++;
    return next + slash + trailing;
  });
  return { text, count };
}

function rewriteToken({
  core,
  transform,
  absoluteOnly,
}: {
  core: string;
  transform: (raw: string) => string;
  absoluteOnly: boolean;
}): string {
  if (core === "" || core.startsWith("/")) return transform(core);
  if (core.startsWith(".")) return absoluteOnly ? core : transform(core);
  if (!absoluteOnly) {
    const relative = transform(core);
    if (relative !== core) return relative;
  }
  // Bare box-root form: `_content/…` without the leading slash.
  const rooted = transform("/" + core);
  return rooted === "/" + core ? core : path.posix.normalize(rooted).slice(1);
}

/**
 * Add the path-mention pass (see mentions.ts) to a `.md` file's link-rewrite
 * result. Other files pass through unchanged.
 */
export function withMentions({
  boxRoot,
  fileAbs,
  linked,
  remap,
  absoluteOnly,
}: {
  boxRoot: string;
  fileAbs: string;
  linked: { text: string; count: number };
  remap: Remap;
  absoluteOnly: boolean;
}): { text: string; count: number } {
  if (!fileAbs.endsWith(".md")) return linked;
  const mentions = rewriteMentions({ boxRoot, fileAbs, text: linked.text, remap, absoluteOnly });
  return { text: mentions.text, count: linked.count + mentions.count };
}
