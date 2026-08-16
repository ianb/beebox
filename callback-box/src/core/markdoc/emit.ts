/**
 * Backend Markdoc AST → markdown emitter.
 *
 * Walks a parsed Markdoc body and emits plain markdown text suitable for
 * `@`-including into CLAUDE.md (which Claude Code reads as raw markdown —
 * it has no Markdoc awareness). Used by `compileBriefing` and any other
 * server-side path that needs to render Markdoc-tagged bodies as
 * markdown.
 *
 * **Why not `Markdoc.format()`.** The upstream serializer has several
 * silent-data-loss and non-convergence bugs documented at
 * `docs/implemented-plans/markdoc-format-investigation.md`. The most disqualifying for us:
 * info-string args after a code fence's language token get dropped
 * (` ```ts setup ` → ` ```ts `). Doctest examples embedded in a card
 * body would be silently corrupted. Hand-rolling this emitter avoids
 * the whole class of problems by emitting only what we want to emit.
 *
 * **Module layout.** The recursive node walker lives in
 * `markdoc/emit-nodes.ts`; per-tag rendering for the briefing vocabulary
 * (`purpose`, `key-person`, `correction`, `property`, `project-phase`),
 * the recipe vocabulary, and the universal `quote`/`source`/`todo`/
 * `see-also` tags lives in `markdoc/emit-tags.ts`. Unknown tags fall back
 * to "emit inner text + stderr warning" (the documented default in
 * Track 2). This file keeps the single public entry point.
 *
 * Walks the AST directly (pre-transform). Tag names are the canonical
 * authored names (`quote`, `key-person`, etc.), not the post-transform
 * React-component names — that keeps this module Markdoc-config-aware
 * but not React-aware.
 */

import Markdoc from "@markdoc/markdoc";

import { emitNode } from "./emit-nodes.js";

// eslint-disable-next-line import-x/no-named-as-default-member
const { parse } = Markdoc;

/**
 * Parse a markdown/Markdoc body and emit it as plain markdown text.
 * Output ends with a single trailing newline.
 */
export function emitBodyAsMarkdown(body: string): string {
  if (body.trim() === "") return "";
  const ast = parse(body);
  const out: string[] = [];
  emitNode(ast, out);
  let text = out.join("");
  // Collapse runs of more than two consecutive newlines down to two.
  text = text.replace(/\n{3,}/g, "\n\n");
  if (!text.endsWith("\n")) text += "\n";
  return text;
}
