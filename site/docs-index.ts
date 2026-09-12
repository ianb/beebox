// Indexes (plan: "The hierarchy"): a directory `index.md` is a plain file
// listing; `llms.txt` is the same thing for the root, plus the spine and the
// existing human-site pages. Both are generated, never hand-written.

import path from "node:path";
import type { PublishedDoc } from "./docs-types.js";

function humanizeDir(dir: string): string {
  const last = dir.split("/").at(-1) ?? dir;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** `/docs/<dir>/index.md`: H1, one purpose line, then one row per file sorted by filename. */
export function renderDirectoryIndex(params: { dir: string; purpose: string; docs: readonly PublishedDoc[] }): string {
  const { dir, purpose, docs } = params;
  const lines = [`# ${humanizeDir(dir)}`, "", purpose, ""];
  const sorted = [...docs].toSorted((a, b) =>
    path.posix.basename(a.publishPath).localeCompare(path.posix.basename(b.publishPath)),
  );
  for (const doc of sorted) {
    const filename = path.posix.basename(doc.publishPath);
    lines.push(`- [${filename}](${filename}): ${doc.description}`);
  }
  return `${lines.join("\n")}\n`;
}

function extractTitle(body: string, fallback: string): string {
  const match = /^#\s+(.+)$/m.exec(body);
  const title = match?.[1]?.trim();
  return title === undefined || title === "" ? fallback : title;
}

export interface DirectoryPurpose {
  dir: string;
  purpose: string;
}

export interface SitePageSummary {
  title: string;
  stem: string;
  summary: string;
  unlisted: boolean;
}

export interface LlmsTxtParams {
  base: string;
  readme: { summary: string; preamble: string };
  spine: readonly PublishedDoc[];
  directories: readonly DirectoryPurpose[];
  sitePages: readonly SitePageSummary[];
}

/**
 * `/llms.txt`: `# Bee Box`, a one-line summary, the README preamble, the
 * spine (`## Start here`), the directories (`## Directories`), then the
 * existing human-site page twins (`## Site pages`, unchanged behaviour).
 */
export function renderAgentLlmsTxt(params: LlmsTxtParams): string {
  const { base, readme, spine, directories, sitePages } = params;
  const lines = ["# Bee Box", "", `> ${readme.summary}`, "", readme.preamble, "", "## Start here", ""];
  for (const doc of spine) {
    const title = extractTitle(doc.body, path.posix.basename(doc.publishPath));
    lines.push(`- [${title}](${base}docs/${doc.publishPath}): ${doc.description}`);
  }
  lines.push("", "## Directories", "");
  for (const dir of directories) {
    lines.push(`- [${dir.dir}/](${base}docs/${dir.dir}/index.md): ${dir.purpose}`);
  }
  lines.push("", "## Site pages", "");
  for (const page of sitePages.filter((p) => !p.unlisted)) {
    lines.push(`- [${page.title}](${base}${page.stem}.md): ${page.summary}`);
  }
  return `${lines.join("\n")}\n`;
}
