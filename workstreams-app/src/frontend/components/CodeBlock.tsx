import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Highlighted source for the browser's code, data, and fenced-block views.
 *
 * highlight.js, because `workstreams-app/src/router/router-markdown.ts` — one
 * of the reading surfaces this browser consolidates — already highlights with
 * it, so the two surfaces agree on what code looks like down to the palette
 * (`styles.css`, the `.hljs-*` rules copied from there). Registered a
 * language at a time off `lib/core` rather than
 * imported whole: the default entry point carries all ~190 grammars, and this
 * is a browser bundle where the corpus is the fourteen below.
 *
 * A language it does not know renders as plain escaped text. Guessing with
 * `highlightAuto` was the alternative and is worse: it is confidently wrong on
 * short files, and mis-colored code reads as a bug in the code.
 */
for (const [name, language] of [
  ["bash", bash], ["css", css], ["diff", diff], ["ini", ini],
  ["javascript", javascript], ["json", json], ["markdown", markdown],
  ["python", python], ["sql", sql], ["swift", swift],
  ["typescript", typescript], ["xml", xml], ["yaml", yaml],
] as const) {
  hljs.registerLanguage(name, language);
}

/**
 * Extension → grammar. Extensions the corpus actually holds (`git ls-files`),
 * plus the near neighbours of each. `.tsx`/`.jsx` ride the plain grammars: the
 * JSX-aware ones are the same modules, and highlight.js reads embedded markup
 * in both.
 */
const LANGUAGE_BY_EXTENSION = new Map<string, string>(Object.entries({
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonl: "json",
  yaml: "yaml", yml: "yaml",
  sh: "bash", bash: "bash", zsh: "bash",
  swift: "swift",
  py: "python",
  css: "css",
  sql: "sql",
  toml: "ini", ini: "ini", properties: "ini",
  xml: "xml", svg: "xml", plist: "xml", html: "xml", htm: "xml",
  md: "markdown", markdown: "markdown",
  diff: "diff", patch: "diff",
}));

/** The grammar for a path, or null when nothing registered fits it. */
export function languageForPath(relPath: string): string | null {
  const extension = relPath.split("/").at(-1)?.split(".").slice(1).at(-1)?.toLowerCase();
  return extension === undefined ? null : LANGUAGE_BY_EXTENSION.get(extension) ?? null;
}

/** The grammar for a fence's info string (```ts), or null when it names none we have. */
export function languageForFence(info: string | null | undefined): string | null {
  const token = (info ?? "").trim().split(/\s+/u)[0]?.toLowerCase();
  if (!token) return null;
  return LANGUAGE_BY_EXTENSION.get(token) ?? (hljs.getLanguage(token) ? token : null);
}

/**
 * Highlighted markup for `source`, or null when the grammar is unknown or the
 * highlighter throws — the caller then renders the text itself, so a grammar
 * failure costs colour and never content.
 */
export function highlightedHtml(source: string, language: string | null): string | null {
  if (language === null || !hljs.getLanguage(language)) return null;
  try {
    return hljs.highlight(source, { language }).value;
  } catch (_error) {
    return null;
  }
}

export function CodeBlock({ source, language }: { source: string; language: string | null }) {
  const html = useMemo(() => highlightedHtml(source, language), [source, language]);
  return (
    <pre className="code-view hljs">
      {html === null
        ? <code>{source}</code>
        // hljs escapes the source it wraps, so the only markup here is its own
        // <span class="hljs-*"> tags.
        : <code className={`language-${language ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />}
    </pre>
  );
}
