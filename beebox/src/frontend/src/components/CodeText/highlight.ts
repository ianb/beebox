/**
 * The highlight.js side of `CodeText`, in its own chunk: `CodeText` imports
 * it on the first coloured file a page shows. Each grammar is a further chunk,
 * loaded and registered once on first use.
 */

import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import type { Grammar } from "../../lib/code-language";

type GrammarModule = Promise<{ default: LanguageFn }>;

// Static specifiers, so the bundler emits one chunk per grammar.
const GRAMMARS: Readonly<Record<Grammar, () => GrammarModule>> = {
  bash: () => import("highlight.js/lib/languages/bash"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  css: () => import("highlight.js/lib/languages/css"),
  diff: () => import("highlight.js/lib/languages/diff"),
  go: () => import("highlight.js/lib/languages/go"),
  ini: () => import("highlight.js/lib/languages/ini"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  python: () => import("highlight.js/lib/languages/python"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  rust: () => import("highlight.js/lib/languages/rust"),
  sql: () => import("highlight.js/lib/languages/sql"),
  swift: () => import("highlight.js/lib/languages/swift"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
};

// HTML colours its <script> and <style> blocks only when these are registered,
// so they load with it and an HTML file looks the same on every open.
const COMPANIONS: Readonly<Partial<Record<Grammar, readonly Grammar[]>>> = {
  xml: ["css", "javascript"],
};

const registering = new Map<Grammar, Promise<void>>();

/** Load and register `grammar`, and any grammar it embeds. */
export async function loadGrammar(grammar: Grammar): Promise<void> {
  await Promise.all([grammar, ...(COMPANIONS[grammar] ?? [])].map(registerGrammar));
}

function registerGrammar(grammar: Grammar): Promise<void> {
  let pending = registering.get(grammar);
  if (pending === undefined) {
    pending = GRAMMARS[grammar]().then((module) => {
      hljs.registerLanguage(grammar, module.default);
    });
    // A failed load is forgotten, so the next file in that language tries again.
    pending.catch(() => registering.delete(grammar));
    registering.set(grammar, pending);
  }
  return pending;
}

/**
 * The source as HTML: every character escaped, tokens wrapped in `hljs-*` spans.
 * `grammar` must be loaded (`loadGrammar`). A carriage return is written as a
 * character reference: HTML parsing turns a literal CRLF into LF, which would
 * change the text a selection copies.
 */
export function highlightHtml(text: string, grammar: Grammar): string {
  return hljs.highlight(text, { language: grammar, ignoreIllegals: true }).value.replaceAll("\r", "&#13;");
}
