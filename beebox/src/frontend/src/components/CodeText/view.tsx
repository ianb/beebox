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
 * a 250 KB TypeScript file took one 300 ms task, and dense code is slower per
 * character, so the limit keeps the worst case near 100 ms.
 */
export const HIGHLIGHT_LIMIT = 64 * 1024;

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

/** A highlight outcome, kept with the text and grammar it came from. */
interface Outcome {
  text: string;
  grammar: Grammar;
  html: string | null;
  failure: string | null;
}

export function CodeText({ text, grammar }: { text: string; grammar: Grammar | null }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  useEffect(() => {
    if (!shouldHighlight(text, grammar)) return;
    let live = true;
    loadHighlighter()
      .then(async (module) => {
        await module.loadGrammar(grammar);
        // The view may have closed or changed while the grammar loaded; skip the parse.
        if (live) setOutcome({ text, grammar, html: module.highlightHtml(text, grammar), failure: null });
      })
      .catch((error: unknown) => {
        if (live) setOutcome({ text, grammar, html: null, failure: error instanceof Error ? error.message : String(error) });
      });
    return () => { live = false; };
  }, [text, grammar]);

  // An outcome for earlier text (the file changed on disk) is never shown.
  const current = outcome !== null && outcome.text === text && outcome.grammar === grammar ? outcome : null;
  const html = current?.html ?? null;
  const failure = current?.failure ?? null;
  return (
    <Pre className="bbx-code" title={failure === null ? undefined : `Syntax colouring unavailable: ${failure}`}>
      {/* highlight.js escapes every character of the source; only its own spans are markup. */}
      {html === null ? text : <code dangerouslySetInnerHTML={{ __html: html }} />}
    </Pre>
  );
}
