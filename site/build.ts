// Static site generator. Run via tsx:
//   pnpm --dir site build            # base derived from the git branch
//   pnpm --dir site build --base /beebox/   # GitHub Pages
//
// Reads site/cards/*.site-page.card, renders each through the local Markdoc
// pipeline (resolving `{% aside ref %}` against the site-aside cards beside
// them), writes HTML + a machine-facing .md twin to site/dist/, generates
// llms.txt, and link-checks every internal link against the emitted output. Any
// broken internal link, malformed frontmatter, unknown ref, or missing source
// fails the build. On success it prints one summary line — noise is a bug.

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { embedAsides, flatAside, loadAsides, renderAside, type AsideCard } from "./asides.js";
import { listCardFiles } from "./cards.js";
import { buildDocsCorpus, renderAgentLlmsTxt, renderDevLlmsTxt, type SitePageSummary } from "./docs.js";
import { baseFromBranch, normalizeBase, resolveInternalHref } from "./links.js";
import { embedNuggets, isRenderable, loadNuggets, renderNugget, type Nugget } from "./nuggets.js";
import { parseSource, renderBody, type PageFrontmatter } from "./render.js";
import { writeManifest } from "./sources.js";
import { NAVIGATION_SCRIPT } from "./navigation-script.js";
import { headingIds, prepareWorkspace, type SitePage } from "./workspace-model.js";
import { workspaceShell } from "./workspace.js";
import { twinCardLinks } from "./twin-links.js";
import { publishedPageBody } from "./page-publication.js";

const SITE_DIR = import.meta.dirname;
const CARDS_DIR = path.join(SITE_DIR, "cards");
const NUGGETS_DIR = path.join(SITE_DIR, "nuggets");
const REPO_ROOT = path.resolve(SITE_DIR, "..");
const BEEBOX_DIR = path.join(REPO_ROOT, "beebox");
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

export interface BuildSiteOptions {
  cardsDir: string;
  distDir: string;
  base: string;
  writeSourceManifest?: boolean;
  /** The agent-docs corpus (dist/docs/, llms.txt sections). Off for box-export dry-runs. */
  buildAgentDocs?: boolean;
}

export interface BuildSiteResult {
  pageCount: number;
  nuggetSummary: string[];
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

interface BuiltPage {
  stem: string;
  frontmatter: PageFrontmatter;
  /** Site-root-relative internal link targets found on the page. */
  linkTargets: { target: string; href: string }[];
}

// The machine-facing twin is the page's flat markdown form: fisheye tag
// markers stripped (all text present, no disclosure), an embedded nugget
// flattened to a blockquote with its provenance, and fenced code blocks left
// untouched — a literal `{% %}` in an example is content, not markup. The
// body carries its own H1; frontmatter is build metadata, not content.
function flatNugget(slug: string, nuggets: readonly Nugget[]): string {
  const nugget = nuggets.find((n) => n.slug === slug);
  // Unknown/refused slugs already failed the build in embedNuggets; this
  // guard only keeps the twin pass from ever being the thing that throws.
  if (!nugget || !isRenderable(nugget)) return "";
  const text = nugget.body === "" ? nugget.span : nugget.body;
  const quoted = text.split("\n").map((line) => `> ${line}`.trimEnd()).join("\n");
  return `${quoted}\n> — from ${nugget.source}`;
}

export function twinMarkdown(
  body: string,
  refs: { nuggets: readonly Nugget[]; asides: ReadonlyMap<string, AsideCard> },
): string {
  const flat = body
    .split(/(```[\S\s]*?```)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part; // inside a code fence: literal content
      // Asides flatten FIRST: flatAside splices in the aside's published body,
      // which may itself carry a {% nugget %} tag — the nugget pass must run
      // after it, or the catch-all strip below silently deletes that nugget.
      return part
        .replace(/{%\s*aside\s+ref="([^"]*)"\s*\/%}/g, (_m, slug: string) => flatAside(slug, refs.asides))
        .replace(/{%\s*nugget\s+slug="([^"]*)"\s*\/%}/g, (_m, slug: string) => flatNugget(slug, refs.nuggets))
        .replace(/{%[\S\s]*?%}/g, "");
    })
    .join("");
  return `${flat.trimStart().trimEnd()}\n`;
}

function sitePageSummaries(pages: BuiltPage[]): SitePageSummary[] {
  return pages.map((p) => ({
    title: p.frontmatter.title,
    stem: p.stem,
    summary: p.frontmatter.summary,
    unlisted: p.frontmatter.unlisted === true,
  }));
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

export async function buildSite(options: BuildSiteOptions): Promise<BuildSiteResult> {
  const cardsDir = path.resolve(options.cardsDir);
  const distDir = path.resolve(options.distDir);
  const base = normalizeBase(options.base);
  const cardsParent = path.dirname(cardsDir);
  const cardsPrefix = `${path.basename(cardsDir)}/`;
  const cards = await listCardFiles({ cardsDir, siteDir: cardsParent });
  if (cards.pages.length === 0) throw new BuildError(`no *.site-page.card sources found in ${cardsDir}`);

  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  const emitted = new Set<string>();
  const built: BuiltPage[] = [];
  const pages: SitePage[] = [];
  const nuggets = await loadNuggets({ nuggetsDir: NUGGETS_DIR, repoRoot: REPO_ROOT });
  const asides = await loadAsides(cards.asides);
  // Render every aside once up front, referenced or not: an empty ready aside
  // or a nested ref fails the build here rather than only on the page that
  // happens to embed it.
  for (const aside of asides.values()) renderAside(aside, { pageSitePath: "index.html", base });

  for (const card of cards.pages) {
    const src = await fs.readFile(card.abs, "utf8");
    const { frontmatter, body: authoredBody } = parseSource(src, card.file);
    const id = card.file.slice(cardsPrefix.length);
    const body = publishedPageBody({ id, frontmatter, body: authoredBody });
    const route = resolveInternalHref({ href: `/${id}`, pageSitePath: id, base });
    const pageSitePath = route.target;
    const rendered = renderBody(body, { file: card.file, pageSitePath: id, base });
    const withAsides = embedAsides(rendered.html, { asides, base, pageSitePath: id });
    const nuggetTargets: string[] = [];
    const html = embedNuggets(withAsides.html, { nuggets, base, pageSitePath: id, linkTargets: nuggetTargets });
    const linkTargets = [...rendered.linkTargets, ...withAsides.linkTargets, ...nuggetTargets];

    const twinOut = path.join(distDir, `${card.slug}.md`);
    if (built.some((page) => page.stem === card.slug)) throw new BuildError(`${card.file}: duplicate Markdown twin ${card.slug}.md`);
    await fs.mkdir(path.dirname(twinOut), { recursive: true });
    pages.push({ id, output: route.target, href: route.href, html: headingIds(html), frontmatter });
    await fs.writeFile(twinOut, twinCardLinks(twinMarkdown(body, { nuggets, asides }), { id, base }), "utf8");

    emitted.add(pageSitePath);
    built.push({
      stem: card.slug,
      frontmatter,
      linkTargets: linkTargets.map((target) => ({ target, href: target })),
    });
  }

  const workspace = prepareWorkspace({ pages, base });
  for (const page of pages) {
    const output = path.join(distDir, page.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, workspaceShell(workspace, page), "utf8");
  }
  await fs.cp(path.join(SITE_DIR, "assets"), path.join(distDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(distDir, "assets/navigation.js"), NAVIGATION_SCRIPT, "utf8");

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
  if (!home) throw new BuildError("no cards/index.site-page.card — the site needs a home page");

  // Agent-docs corpus (site/docs.ts): dist/docs/ plus the inputs for llms.txt's
  // spine and directory sections. Off for box-export dry-runs, which validate
  // a temporary workbench card export and have no bearing on the docs corpus.
  const docsSummary: string[] = [];
  if (options.buildAgentDocs !== false) {
    const docsResult = await buildDocsCorpus({ repoRoot: REPO_ROOT, siteDir: SITE_DIR, beeboxDir: BEEBOX_DIR, distDir, base });
    docsSummary.push(docsResult.summaryLine);
    await fs.writeFile(
      path.join(distDir, "llms.txt"),
      renderAgentLlmsTxt({
        base,
        readme: docsResult.readme,
        spine: docsResult.spine,
        directories: docsResult.directories,
        sitePages: sitePageSummaries(built),
        hasDevEntry: docsResult.dev !== undefined,
      }),
      "utf8",
    );
    if (docsResult.dev !== undefined) {
      await fs.writeFile(
        path.join(distDir, "llms-dev.txt"),
        renderDevLlmsTxt({
          base,
          readme: docsResult.dev.readme,
          startHere: docsResult.dev.startHere,
          files: docsResult.dev.files,
          also: docsResult.dev.also,
        }),
        "utf8",
      );
    }
  }

  // Input manifest LAST, once all output exists: the dev router compares it
  // against the current sources to decide whether to auto-rebuild. A partial
  // build never leaves a manifest that could mask staleness.
  if (options.writeSourceManifest !== false) await writeManifest(SITE_DIR, distDir);

  return { pageCount: built.length, nuggetSummary: [...nuggetSummary, ...docsSummary] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const base = resolveBase(args);
  const result = await buildSite({ cardsDir: CARDS_DIR, distDir: DIST_DIR, base });

  process.stdout.write(
    [`site: built ${result.pageCount} page(s) → dist/ (base ${base})`, ...result.nuggetSummary].join("\n") + "\n",
  );
}

// Run only when invoked as the CLI — the test file imports twinMarkdown and
// must not trigger a build.
if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`site build failed: ${message}\n`);
    process.exitCode = 1;
  });
}
