/**
 * The text of a code file, coloured by language.
 *
 * The text paints uncoloured at once; the highlighter (`./highlight.ts`, its
 * own chunk) colours it when it arrives. Text over HIGHLIGHT_LIMIT, a file with
 * no grammar, a highlighter chunk that does not load, and a grammar that throws
 * all leave the text uncoloured. Token colours come from the card theme
 * (`.bbx-code` in `themes/card-themes.css`).
 */

import { useEffect, useState } from "react";
import { Pre } from "../ui/Pre";
import type { Grammar } from "../../lib/code-language";
// Type-only: erased at build, so highlight.js stays out of this chunk.
import type * as HighlightModule from "./highlight";

/**
 * In UTF-16 code units (`text.length`). Highlighting runs on the main thread:
 * a 250 KB TypeScript file took one 300 ms task, so the limit is half that.
 */
export const HIGHLIGHT_LIMIT = 128 * 1024;

export function shouldHighlight(text: string, grammar: Grammar | null): grammar is Grammar {
  return grammar !== null && text.length > 0 && text.length <= HIGHLIGHT_LIMIT;
}

let highlighter: Promise<typeof HighlightModule> | null = null;

function loadHighlighter(): Promise<typeof HighlightModule> {
  highlighter ??= import("./highlight");
  // A failed chunk load is forgotten, so the next file tries again.
  highlighter.catch(() => { highlighter = null; });
  return highlighter;
}

interface Highlighted {
  text: string;
  grammar: Grammar;
  html: string;
}

export function CodeText({ text, grammar }: { text: string; grammar: Grammar | null }) {
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!shouldHighlight(text, grammar)) return;
    let live = true;
    loadHighlighter()
      .then((module) => module.highlightHtml(text, grammar))
      .then((html) => {
        if (!live) return;
        setHighlighted({ text, grammar, html });
        setFailure(null);
      }, (error: unknown) => {
        if (live) setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => { live = false; };
  }, [text, grammar]);

  // A result from earlier text (the file changed on disk) is never shown.
  const html = highlighted !== null && highlighted.text === text && highlighted.grammar === grammar ? highlighted.html : null;
  return (
    <Pre className="bbx-code" title={failure === null ? undefined : `Syntax colouring unavailable: ${failure}`}>
      {/* highlight.js escapes every character of the source; only its own spans are markup. */}
      {html === null ? text : <code dangerouslySetInnerHTML={{ __html: html }} />}
    </Pre>
  );
}
