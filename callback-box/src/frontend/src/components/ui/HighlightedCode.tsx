/**
 * Thin wrapper that renders syntax-highlighted HTML produced by highlight.js
 * inside a `<code>` with the required `hljs` class. Living in components/
 * keeps the library-specific class off of page-level code, where the
 * restrict-component-classes rule wouldn't allow it.
 *
 * Callers generate the highlighted HTML (via hljs.highlight) and pass it here.
 * Pair with `<Pre boxed>` for a standard code-block look.
 */
export interface HighlightedCodeProps {
  /** HTML produced by highlight.js (already escaped + span-wrapped). */
  html: string;
}

export function HighlightedCode({ html }: HighlightedCodeProps) {
  return <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />;
}
