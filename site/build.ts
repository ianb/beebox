// Static site generator. Run via tsx:
//   pnpm --dir site build            # base derived from the git branch
//   pnpm --dir site build --base /callback-box/   # GitHub Pages
//
// Reads site/content/*.md, renders each through the local Markdoc pipeline,
// writes HTML + a machine-facing .md twin to site/dist/, generates llms.txt,
// and link-checks every internal link against the emitted output. Any broken
// internal link, malformed frontmatter, or missing source fails the build.
// On success it prints one summary line — routine noise is a bug.

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { baseFromBranch, normalizeBase } from "./links.js";
import { embedNuggets, isRenderable, loadNuggets, renderNugget, type Nugget } from "./nuggets.js";
import { parseSource, renderBody, pageShell, type PageFrontmatter } from "./render.js";
import { writeManifest } from "./sources.js";

const SITE_DIR = import.meta.dirname;
const CONTENT_DIR = path.join(SITE_DIR, "content");
const NUGGETS_DIR = path.join(SITE_DIR, "nuggets");
const REPO_ROOT = path.resolve(SITE_DIR, "..");
const DIST_DIR = path.join(SITE_DIR, "dist");

class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildError";
  }
}

interface CliArgs {
  base: string | undefined;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let base: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--base") {
      const value = argv[++i];
      if (value === undefined) throw new BuildError("--base requires a value");
      base = value;
    } else if (arg.startsWith("--base=")) {
      base = arg.slice("--base=".length);
    } else {
      throw new BuildError(`unknown argument: ${arg}`);
    }
  }
  return { base };
}

function resolveBase(args: CliArgs): string {
  if (args.base !== undefined) return normalizeBase(args.base);
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: SITE_DIR })
    .toString()
    .trim();
  return baseFromBranch(branch);
}

interface ContentFile {
  /** Absolute source path. */
  abs: string;
  /** Site-root-relative path without extension, e.g. "index" or "sub/about". */
  stem: string;
}

async function collectContent(dir: string, prefix: string): Promise<ContentFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: ContentFile[] = [];
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectContent(abs, `${prefix}${entry.name}/`)));
    } else if (entry.name.endsWith(".md")) {
      out.push({ abs, stem: `${prefix}${entry.name.slice(0, -".md".length)}` });
    }
  }
  return out;
}

interface BuiltPage {
  stem: string;
  frontmatter: PageFrontmatter;
  /** Site-root-relative internal link targets found on the page. */
  linkTargets: { target: string; href: string }[];
}

// The machine-facing twin is the page's flat markdown form: the body with the
// fisheye tag markers stripped, so all text is present with no disclosure
// (an embedded nugget's placeholder disappears — the nugget's own source is
// already repo content). The body carries its own H1; frontmatter is build
// metadata, not content.
function twinMarkdown(body: string): string {
  return `${body.replace(/{%[\S\s]*?%}/g, "").trimStart().trimEnd()}\n`;
}

function renderLlmsTxt(params: { home: PageFrontmatter; pages: BuiltPage[]; base: string }): string {
  const lines = [`# ${params.home.title}`, "", `> ${params.home.summary}`, "", "## Pages", ""];
  for (const page of params.pages.filter((p) => p.frontmatter.unlisted !== true)) {
    lines.push(`- [${page.frontmatter.title}](${params.base}${page.stem}.md): ${page.frontmatter.summary}`);
  }
  return `${lines.join("\n")}\n`;
}

// Nugget enforcement at build: `proposed` nuggets are refused (never rendered,
// always listed by slug — the AI-words rule is code, not convention), and every
// publishable one is rendered here so a nugget that cannot render fails the
// build now rather than on the page that later embeds it. Span drift is not a
// failure: it renders with a stale marker and is counted in the summary.
function checkNuggets(nuggets: readonly Nugget[], base: string): string[] {
  const refused = nuggets.filter((n) => !isRenderable(n));
  const publishable = nuggets.filter((n) => isRenderable(n));
  const stale: string[] = [];
  for (const nugget of publishable) {
    renderNugget(nugget, { base, pageSitePath: "index.html" });
    if (nugget.spanState !== "current") stale.push(`${nugget.slug} (${nugget.spanState} in ${nugget.source})`);
  }
  const lines: string[] = [];
  if (nuggets.length > 0) {
    lines.push(`site: ${publishable.length} nugget(s) publishable, ${refused.length} refused, ${stale.length} stale`);
  }
  if (refused.length > 0) {
    lines.push(`site: refused (status proposed, never published): ${refused.map((n) => n.slug).join(", ")}`);
  }
  for (const line of stale) lines.push(`site: nugget span drifted — ${line}`);
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const base = resolveBase(args);

  const content = await collectContent(CONTENT_DIR, "");
  if (content.length === 0) throw new BuildError(`no .md sources found in ${CONTENT_DIR}`);

  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(DIST_DIR, { recursive: true });

  const emitted = new Set<string>();
  const built: BuiltPage[] = [];
  const nuggets = await loadNuggets({ nuggetsDir: NUGGETS_DIR, repoRoot: REPO_ROOT });

  for (const file of content) {
    const src = await fs.readFile(file.abs, "utf8");
    const relForErrors = path.relative(SITE_DIR, file.abs);
    const { frontmatter, body } = parseSource(src, relForErrors);
    const pageSitePath = `${file.stem}.html`;
    const rendered = renderBody(body, { pageSitePath, base });
    const html = embedNuggets(rendered.html, { nuggets, base, pageSitePath });
    const { linkTargets } = rendered;

    const htmlOut = path.join(DIST_DIR, pageSitePath);
    const twinOut = path.join(DIST_DIR, `${file.stem}.md`);
    await fs.mkdir(path.dirname(htmlOut), { recursive: true });
    await fs.writeFile(htmlOut, pageShell({ title: frontmatter.title, bodyHtml: html, base }), "utf8");
    await fs.writeFile(twinOut, twinMarkdown(body), "utf8");

    emitted.add(pageSitePath);
    built.push({
      stem: file.stem,
      frontmatter,
      linkTargets: linkTargets.map((target) => ({ target, href: target })),
    });
  }

  // Link-check: every internal link target must correspond to an emitted page.
  const broken: string[] = [];
  for (const page of built) {
    for (const { target } of page.linkTargets) {
      if (!emitted.has(target)) broken.push(`${page.stem}.md → ${target}`);
    }
  }
  if (broken.length > 0) {
    throw new BuildError(`broken internal link(s):\n  ${broken.join("\n  ")}`);
  }

  const nuggetSummary = checkNuggets(nuggets, base);

  const home = built.find((p) => p.stem === "index");
  if (!home) throw new BuildError("no index.md — the site needs a home page");
  await fs.writeFile(
    path.join(DIST_DIR, "llms.txt"),
    renderLlmsTxt({ home: home.frontmatter, pages: built, base }),
    "utf8",
  );

  // Input manifest LAST, once all output exists: the dev router compares it
  // against the current sources to decide whether to auto-rebuild. A partial
  // build never leaves a manifest that could mask staleness.
  await writeManifest(SITE_DIR, DIST_DIR);

  process.stdout.write(
    [`site: built ${built.length} page(s) → dist/ (base ${base})`, ...nuggetSummary].join("\n") + "\n",
  );
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`site build failed: ${message}\n`);
  process.exitCode = 1;
});
