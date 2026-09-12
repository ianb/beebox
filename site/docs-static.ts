// Static files the agent-docs corpus needs on the canonical host, written
// beside llms.txt at build. Cloudflare Pages reads `_headers` and `404.html`
// from the output directory; the dev router ignores them.
//
// - `_headers`: every machine-facing file is served as `text/plain`. Pages
//   serves `.md` as `text/markdown`, and chat-app fetchers (ChatGPT, Gemini)
//   report such files as unavailable or empty even on a 200; `text/plain`
//   works (the llms.txt itself was already plain). One rule per emitted `.md`
//   twin and one wildcard for `/docs/`.
// - `404.html`: without one, Pages answers every unknown path with the home
//   page and a 200, so a fetcher that guesses a URL is rewarded with a
//   plausible page instead of a miss.
// - `robots.txt`: the same fallback served HTML for it; a real one allows all.

import fs from "node:fs/promises";
import path from "node:path";

const PLAIN = "  Content-Type: text/plain; charset=utf-8";

export function renderHeadersFile(params: { base: string; twinStems: readonly string[] }): string {
  const { base, twinStems } = params;
  const rules = [`${base}docs/*`, `${base}llms.txt`, `${base}llms-dev.txt`, ...twinStems.map((stem) => `${base}${stem}.md`)];
  return `${rules.map((rule) => `${rule}\n${PLAIN}`).join("\n\n")}\n`;
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
export async function writeStaticFiles(params: { distDir: string; base: string; twinStems: readonly string[] }): Promise<void> {
  const { distDir, base, twinStems } = params;
  await fs.writeFile(path.join(distDir, "_headers"), renderHeadersFile({ base, twinStems }), "utf8");
  await fs.writeFile(path.join(distDir, "404.html"), renderNotFoundPage(), "utf8");
  await fs.writeFile(path.join(distDir, "robots.txt"), renderRobotsTxt(), "utf8");
}
