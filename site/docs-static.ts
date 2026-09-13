// Static files the agent-docs corpus needs on the canonical host, written
// beside llms.txt at build. Cloudflare Pages reads `_headers` and `404.html`
// from the output directory; the dev router ignores them.
//
// - `_headers`: every `.md` under `/docs/` and every page twin is served as
//   `text/plain` (Pages serves `.md` as `text/markdown`, and chat-app
//   fetchers report such files as unavailable or empty even on a 200); the
//   `.md` under `/docs/` is served as HTML — a `<path>.html` sibling next to
//   every `<path>.md` is left to Cloudflare's own default (already
//   `text/html`, so no rule is needed for it). Each entry point (`llms.txt`,
//   and `llms-dev.txt`/`llms-install.txt` when built) is itself HTML now —
//   "llms.txt will return text/html and that's fine" — while its plain-text
//   twin (`llms.md`, …) stays `text/plain`.
// - `404.html`: without one, Pages answers every unknown path with the home
//   page and a 200, so a fetcher that guesses a URL is rewarded with a
//   plausible page instead of a miss.
// - `robots.txt`: the same fallback served HTML for it; a real one allows all.

import fs from "node:fs/promises";
import path from "node:path";

const PLAIN = "  Content-Type: text/plain; charset=utf-8";
const HTML = "  Content-Type: text/html; charset=utf-8";

export function renderHeadersFile(params: { base: string; twinStems: readonly string[]; entryStems: readonly string[] }): string {
  const { base, twinStems, entryStems } = params;
  const plainRules = [`${base}docs/*.md`, ...twinStems.map((stem) => `${base}${stem}.md`), ...entryStems.map((stem) => `${base}${stem}.md`)];
  const htmlRules = entryStems.map((stem) => `${base}${stem}.txt`);
  const blocks = [
    ...plainRules.map((rule) => `${rule}\n${PLAIN}`),
    ...htmlRules.map((rule) => `${rule}\n${HTML}`),
  ];
  return `${blocks.join("\n\n")}\n`;
}

export function renderNotFoundPage(): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>Not found | Bee Box</title></head>',
    "<body><h1>Not found</h1><p>There is no page at this address. The documentation index is at <a href=\"/llms.txt\">/llms.txt</a>.</p></body></html>",
    "",
  ].join("\n");
}

export function renderRobotsTxt(): string {
  return "User-agent: *\nAllow: /\n";
}

/** Write the three static files into `distDir`. */
export async function writeStaticFiles(params: {
  distDir: string;
  base: string;
  twinStems: readonly string[];
  entryStems: readonly string[];
}): Promise<void> {
  const { distDir, base, twinStems, entryStems } = params;
  await fs.writeFile(path.join(distDir, "_headers"), renderHeadersFile({ base, twinStems, entryStems }), "utf8");
  await fs.writeFile(path.join(distDir, "404.html"), renderNotFoundPage(), "utf8");
  await fs.writeFile(path.join(distDir, "robots.txt"), renderRobotsTxt(), "utf8");
}
