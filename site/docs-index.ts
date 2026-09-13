// Indexes (plan: "The hierarchy"): a directory `index.md` is a plain file
// listing; `llms.txt` is a deep index — every page under the "content"
// directories, grouped by directory — plus the spine and the existing
// human-site pages. `llms-dev.txt` and `llms-install.txt` are themselves
// entry points for their own directory's children (dev/ and install/ are
// deliberately NOT expanded on the front page — see site/CLAUDE.md's Agent
// docs section). All three are generated, never hand-written.

import path from "node:path";
import { docsOrigin } from "./docs-origin.js";
import type { PublishedDoc } from "./docs-types.js";

export class DocsIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsIndexError";
  }
}

/** The front page's deep-index directories, in display order. dev/ and install/ get entry pages instead. */
export const DEEP_DIRS = [
  "uses",
  "capabilities",
  "concepts",
  "security",
  "architecture",
  "design",
  "compared",
  "contracts",
  "reference",
  "reference/cards",
] as const;

function humanizeDir(dir: string): string {
  const last = dir.split("/").at(-1) ?? dir;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function extractTitle(body: string, fallback: string): string {
  const match = /^#\s+(.+)$/m.exec(body);
  const title = match?.[1]?.trim();
  return title === undefined || title === "" ? fallback : title;
}

function sortByFilename(docs: readonly PublishedDoc[]): PublishedDoc[] {
  return [...docs].toSorted((a, b) => path.posix.basename(a.publishPath).localeCompare(path.posix.basename(b.publishPath)));
}

/** `/docs/<dir>/index.md`: H1, one purpose line, then one row per file sorted by filename. */
export function renderDirectoryIndex(params: {
  dir: string;
  purpose: string;
  docs: readonly PublishedDoc[];
  base: string;
}): string {
  const { dir, purpose, docs, base } = params;
  const origin = docsOrigin(base);
  const lines = [`# ${humanizeDir(dir)}`, "", purpose, ""];
  for (const doc of sortByFilename(docs)) {
    const filename = path.posix.basename(doc.publishPath);
    lines.push(`- [${filename}](${origin}${base}docs/${dir}/${filename}): ${doc.description}`);
  }
  return `${lines.join("\n")}\n`;
}

export interface DirectoryPurpose {
  dir: string;
  purpose: string;
}

/** A deep-index section: a directory's purpose plus every doc published in it. */
export interface DirectorySection extends DirectoryPurpose {
  docs: readonly PublishedDoc[];
}

export interface SitePageSummary {
  title: string;
  /** Absolute URL of the rendered human page (not its `.md` twin). */
  href: string;
  summary: string;
  unlisted: boolean;
}

export interface LlmsTxtParams {
  base: string;
  readme: { summary: string; preamble: string };
  spine: readonly PublishedDoc[];
  /** DEEP_DIRS, filtered to directories that currently have any published doc. */
  directories: readonly DirectorySection[];
  /** docs/install/'s own purpose line, for the pointer to llms-install.txt — undefined if install/ has no docs yet. */
  installDir: DirectoryPurpose | undefined;
  /** docs/dev/'s own purpose line, for the pointer to llms-dev.txt — undefined if there's no dev/README.md. */
  devDir: DirectoryPurpose | undefined;
  sitePages: readonly SitePageSummary[];
}

function deepEntryRow(base: string, doc: PublishedDoc): string {
  const origin = docsOrigin(base);
  const title = extractTitle(doc.body, path.posix.basename(doc.publishPath));
  return `- [${title}](${origin}${base}docs/${doc.publishPath}): ${doc.description}`;
}

/**
 * `/llms.txt`: `# Bee Box`, a one-line summary, the README preamble, the
 * spine (`## Start here`), then one `## <dir>/` per deep directory listing
 * every page in it, an `## Install` and `## Contributing` pointer to their
 * own entry pages, then the existing human-site page twins (`## Site
 * pages`). Every published path outside `dev/`/`install/` appears exactly
 * once; `dev/`/`install/` are represented only by their entry-page pointer.
 */
export function renderAgentLlmsTxt(params: LlmsTxtParams): string {
  const { base, readme, spine, directories, installDir, devDir, sitePages } = params;
  const origin = docsOrigin(base);
  const lines = ["# Bee Box", "", `> ${readme.summary}`, "", readme.preamble, "", "## Start here", ""];
  for (const doc of spine) lines.push(deepEntryRow(base, doc));

  for (const section of directories) {
    lines.push("", `## ${section.dir}/`, "", section.purpose, "");
    for (const doc of sortByFilename(section.docs)) lines.push(deepEntryRow(base, doc));
  }

  if (installDir !== undefined) {
    lines.push(
      "",
      "## Install",
      "",
      `- [install/](${origin}${base}docs/install/index.md): ${installDir.purpose}`,
      `- [llms-install.txt](${origin}${base}llms-install.txt): how to get a box running.`,
    );
  }
  if (devDir !== undefined) {
    lines.push(
      "",
      "## Contributing",
      "",
      `- [dev/](${origin}${base}docs/dev/index.md): ${devDir.purpose}`,
      `- [llms-dev.txt](${origin}${base}llms-dev.txt): the contributor entry point: repo layout, running it, tests, how a change lands.`,
    );
  }

  lines.push("", "## Site pages", "");
  for (const page of sitePages.filter((p) => !p.unlisted)) {
    lines.push(`- [${page.title}](${page.href}): ${page.summary}`);
  }
  return `${lines.join("\n")}\n`;
}

export interface EntryIndexParams {
  base: string;
  title: string;
  /** The directory this entry page indexes (its files publish at docs/<dirName>/<filename>). */
  dirName: string;
  readme: { summary: string; preamble: string };
  startHere: readonly string[] | undefined;
  /** Every doc published directly under dirName. */
  files: readonly PublishedDoc[];
  /** Extra pointers after the file listing (dev/'s fixed "## Also" set; empty for install/). */
  also: readonly DirectoryPurpose[];
}

function fileRow(params: { base: string; dirName: string; doc: PublishedDoc }): string {
  const { base, dirName, doc } = params;
  const filename = path.posix.basename(doc.publishPath);
  return `- [${filename}](${docsOrigin(base)}${base}docs/${dirName}/${filename}): ${doc.description}`;
}

/**
 * A contributor/install-style entry page: `# <title>`, the directory's
 * `README.md` summary + body as preamble, an optional `## Start here` (its
 * `start-here:` order) then `## Files` (everything else, sorted by
 * filename), then `## Also` pointing back at the rest of the corpus and at
 * `llms.txt`. `renderDevLlmsTxt` and `renderInstallLlmsTxt` below are named
 * call sites of this one shape.
 */
export function renderEntryLlmsTxt(params: EntryIndexParams): string {
  const { base, title, dirName, readme, startHere, files, also } = params;
  const sorted = sortByFilename(files);
  const lines = [`# ${title}`, "", `> ${readme.summary}`, "", readme.preamble];

  let rest = sorted;
  if (startHere !== undefined && startHere.length > 0) {
    const byFilename = new Map(sorted.map((doc) => [path.posix.basename(doc.publishPath), doc]));
    lines.push("", "## Start here", "");
    for (const filename of startHere) {
      const doc = byFilename.get(filename);
      if (doc === undefined) {
        throw new DocsIndexError(`site/docs/${dirName}/README.md: start-here lists "${filename}", which is not published under ${dirName}/`);
      }
      lines.push(fileRow({ base, dirName, doc }));
    }
    const started = new Set(startHere);
    rest = sorted.filter((doc) => !started.has(path.posix.basename(doc.publishPath)));
  }

  lines.push("", "## Files", "");
  for (const doc of rest) lines.push(fileRow({ base, dirName, doc }));

  lines.push("", "## Also", "");
  const origin = docsOrigin(base);
  for (const dir of also) lines.push(`- [${dir.dir}/](${origin}${base}docs/${dir.dir}/index.md): ${dir.purpose}`);
  lines.push(`- [llms.txt](${origin}${base}llms.txt): the evaluator-facing index; what Bee Box is and whether to use it.`);

  return `${lines.join("\n")}\n`;
}
