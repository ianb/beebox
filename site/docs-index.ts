// Indexes (plan: "The hierarchy"): a directory `index.md` is a plain file
// listing; `llms.txt` is the same thing for the root, plus the spine and the
// existing human-site pages. Both are generated, never hand-written.

import path from "node:path";
import type { PublishedDoc } from "./docs-types.js";

export class DocsIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsIndexError";
  }
}

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
  /** True when dist/llms-dev.txt is also being written (site/docs/dev/README.md is present). */
  hasDevEntry: boolean;
}

/**
 * `/llms.txt`: `# Bee Box`, a one-line summary, the README preamble, the
 * spine (`## Start here`), the directories (`## Directories`), an optional
 * `## Contributing` pointer to the dev entry point, then the existing
 * human-site page twins (`## Site pages`, unchanged behaviour).
 */
export function renderAgentLlmsTxt(params: LlmsTxtParams): string {
  const { base, readme, spine, directories, sitePages, hasDevEntry } = params;
  const lines = ["# Bee Box", "", `> ${readme.summary}`, "", readme.preamble, "", "## Start here", ""];
  for (const doc of spine) {
    const title = extractTitle(doc.body, path.posix.basename(doc.publishPath));
    lines.push(`- [${title}](${base}docs/${doc.publishPath}): ${doc.description}`);
  }
  lines.push("", "## Directories", "");
  for (const dir of directories) {
    lines.push(`- [${dir.dir}/](${base}docs/${dir.dir}/index.md): ${dir.purpose}`);
  }
  if (hasDevEntry) {
    lines.push(
      "",
      "## Contributing",
      "",
      `- [llms-dev.txt](${base}llms-dev.txt): the contributor entry point: repo layout, running it, tests, how a change lands.`,
      `- [dev/](${base}docs/dev/index.md): development process docs.`,
    );
  }
  lines.push("", "## Site pages", "");
  for (const page of sitePages.filter((p) => !p.unlisted)) {
    lines.push(`- [${page.title}](${base}${page.stem}.md): ${page.summary}`);
  }
  return `${lines.join("\n")}\n`;
}

export interface DevLlmsTxtParams {
  base: string;
  readme: { summary: string; preamble: string };
  startHere: readonly string[] | undefined;
  /** Docs published directly under dev/ (not root, not authored index/README stubs). */
  files: readonly PublishedDoc[];
  /** contracts/, design/, reference/, reference/cards/, security/, concepts/, in that order. */
  also: readonly DirectoryPurpose[];
}

function fileRow(base: string, doc: PublishedDoc): string {
  const filename = path.posix.basename(doc.publishPath);
  return `- [${filename}](${base}docs/dev/${filename}): ${doc.description}`;
}

/**
 * `/llms-dev.txt`: the contributor entry point. `# Bee Box for contributors`,
 * the dev/README.md summary + body as preamble, an optional `## Start here`
 * (the README's `start-here:` order) then `## Files` (everything else, sorted
 * by filename), then `## Also` pointing at the rest of the corpus.
 */
export function renderDevLlmsTxt(params: DevLlmsTxtParams): string {
  const { base, readme, startHere, files, also } = params;
  const sorted = [...files].toSorted((a, b) =>
    path.posix.basename(a.publishPath).localeCompare(path.posix.basename(b.publishPath)),
  );
  const lines = ["# Bee Box for contributors", "", `> ${readme.summary}`, "", readme.preamble];

  let rest = sorted;
  if (startHere !== undefined && startHere.length > 0) {
    const byFilename = new Map(sorted.map((doc) => [path.posix.basename(doc.publishPath), doc]));
    lines.push("", "## Start here", "");
    for (const filename of startHere) {
      const doc = byFilename.get(filename);
      if (doc === undefined) {
        throw new DocsIndexError(`site/docs/dev/README.md: start-here lists "${filename}", which is not published under dev/`);
      }
      lines.push(fileRow(base, doc));
    }
    const started = new Set(startHere);
    rest = sorted.filter((doc) => !started.has(path.posix.basename(doc.publishPath)));
  }

  lines.push("", "## Files", "");
  for (const doc of rest) lines.push(fileRow(base, doc));

  lines.push("", "## Also", "");
  for (const dir of also) lines.push(`- [${dir.dir}/](${base}docs/${dir.dir}/index.md): ${dir.purpose}`);
  lines.push(`- [llms.txt](${base}llms.txt): the evaluator-facing index; what Bee Box is and whether to use it.`);

  return `${lines.join("\n")}\n`;
}
