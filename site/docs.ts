// Agent-docs corpus orchestrator: builds the /docs/ tree from three source
// kinds (authored, promoted, generated) and hands back what build.ts needs to
// render the combined llms.txt. See beebox/docs/plans/agent-docs.md and the
// workstream's file contract for the full spec.

import fs from "node:fs/promises";
import path from "node:path";
import { loadAuthoredDocs, DocsAuthoredError } from "./docs-authored.js";
import { renderComparedCaveat } from "./docs-compared.js";
import { renderCorpusPageHtml, renderDirectoryIndexHtml } from "./docs-html.js";
import { loadGeneratedDocs } from "./docs-generated.js";
import { DEEP_DIRS, renderDirectoryIndex, type DirectoryPurpose, type DirectorySection } from "./docs-index.js";
import { rewriteAuthoredLinks } from "./docs-links.js";
import { loadManifestEntries, loadPromotedDocs } from "./docs-manifest.js";
import { docsOrigin } from "./docs-origin.js";
import type { PublishedDoc } from "./docs-types.js";

export type { SitePageSummary } from "./docs-index.js";

export class DocsBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsBuildError";
  }
}

export interface DocsBuildOptions {
  repoRoot: string;
  siteDir: string;
  beeboxDir: string;
  distDir: string;
  base: string;
}

/** The `## Also` directories in llms-dev.txt, in fixed display order. */
const DEV_ALSO_DIRS = ["contracts", "design", "reference", "reference/cards", "security", "concepts"] as const;

const DEFAULT_INSTALL_README = { summary: "How to get a box running.", preamble: "" };

export interface EntryInput {
  readme: { summary: string; preamble: string };
  startHere: readonly string[] | undefined;
  files: readonly PublishedDoc[];
  also: readonly DirectoryPurpose[];
}

export interface DocsBuildResult {
  docCount: number;
  readme: { summary: string; preamble: string };
  spine: readonly PublishedDoc[];
  /** DEEP_DIRS, filtered to directories that currently have any published doc. */
  deepDirectories: readonly DirectorySection[];
  installDir: DirectoryPurpose | undefined;
  devDir: DirectoryPurpose | undefined;
  /** The input for dist/llms-install.txt — undefined only when install/ has no published docs yet. */
  install: EntryInput | undefined;
  /** Present only when site/docs/dev/README.md exists — the input for dist/llms-dev.txt. */
  dev: EntryInput | undefined;
  summaryLine: string;
}

function directoryOf(publishPath: string): string {
  const dir = path.posix.dirname(publishPath);
  return dir === "." ? "" : dir;
}

/** `Bee Box documentation · directory: … · index: … · root: …`, absolute-URL-prefixed. */
function headerLine(publishPath: string, base: string): string {
  const origin = docsOrigin(base);
  const dir = directoryOf(publishPath);
  const directoryPath = dir === "" ? `${origin}${base}docs/` : `${origin}${base}docs/${dir}/`;
  const indexPath = dir === "" ? `${origin}${base}llms.txt` : `${origin}${base}docs/${dir}/index.md`;
  return `Bee Box documentation · directory: ${directoryPath} · index: ${indexPath} · root: ${origin}${base}llms.txt`;
}

/** Write a published doc's `.md` twin and its spartan `.html` rendering, side by side. */
async function writeDoc(params: { distDir: string; doc: PublishedDoc; base: string }): Promise<void> {
  const { distDir, doc, base } = params;
  const parts = [headerLine(doc.publishPath, base), ""];
  if (doc.compared) parts.push(...renderComparedCaveat(doc.compared), "");
  parts.push(doc.body.trim());
  const out = path.join(distDir, "docs", doc.publishPath);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${parts.join("\n")}\n`, "utf8");
  await fs.writeFile(out.replace(/\.md$/, ".html"), renderCorpusPageHtml({ doc, base }), "utf8");
}

/** Write one directory's `index.md` and its spartan `index.html` rendering. */
async function writeDirectoryIndex(params: { distDir: string; dir: string; purpose: string; docs: PublishedDoc[]; base: string }): Promise<void> {
  const { distDir, dir, purpose, docs, base } = params;
  const markdown = renderDirectoryIndex({ dir, purpose, docs, base });
  const out = path.join(distDir, "docs", dir, "index.md");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, markdown, "utf8");
  await fs.writeFile(path.join(distDir, "docs", dir, "index.html"), renderDirectoryIndexHtml({ dir, markdown, base }), "utf8");
}

/** Build the whole /docs/ tree into distDir/docs/, and return the llms.txt inputs. */
export async function buildDocsCorpus(options: DocsBuildOptions): Promise<DocsBuildResult> {
  const { repoRoot, siteDir, beeboxDir, distDir, base } = options;
  const docsDir = path.join(siteDir, "docs");
  const manifestPath = path.join(siteDir, "docs-manifest.yaml");

  const manifestEntries = loadManifestEntries(manifestPath);
  const promoted = loadPromotedDocs({ entries: manifestEntries, repoRoot, base });
  const generated = loadGeneratedDocs({ beeboxDir, repoRoot, base });
  const authored = await loadAuthoredDocs({ docsDir, repoRoot });

  const allDocs: PublishedDoc[] = [...authored.docs, ...promoted, ...generated.docs];

  const byDir = new Map<string, PublishedDoc[]>();
  for (const doc of allDocs) {
    const dir = directoryOf(doc.publishPath);
    if (dir === "") continue; // spine files: llms.txt is their index, no per-directory index.md
    const list = byDir.get(dir) ?? [];
    list.push(doc);
    byDir.set(dir, list);
  }

  const directories: DirectoryPurpose[] = [];
  for (const dir of [...byDir.keys()].toSorted((a, b) => a.localeCompare(b))) {
    const purpose = authored.indexPurposes.get(dir);
    if (purpose === undefined) {
      throw new DocsAuthoredError(
        `docs/${dir}/ has published file(s) but no site/docs/${dir}/index.md stub (needs frontmatter "description:")`,
      );
    }
    directories.push({ dir, purpose });
  }

  if (authored.readme === undefined) {
    throw new DocsBuildError("site/docs/README.md is required (the llms.txt one-line summary and preamble)");
  }

  // A generated per-directory index.md is a real published file, even though
  // it isn't in `allDocs` (it's synthesized, not sourced from one doc) — an
  // authored page linking to "capabilities/index.md" must resolve.
  const publishedPaths = new Set(allDocs.map((d) => d.publishPath));
  for (const dir of byDir.keys()) publishedPaths.add(`${dir}/index.md`);

  for (const doc of authored.docs) {
    doc.body = rewriteAuthoredLinks(doc.body, { publishPath: doc.publishPath, sourceLabel: doc.sourceLabel, publishedPaths, base });
  }

  // README preambles (root + per-directory) carry the same published-relative
  // links as any authored page — resolved against their own directory — but
  // they never flow through `authored.docs`, so they need their own pass.
  authored.readme = {
    summary: authored.readme.summary,
    preamble: rewriteAuthoredLinks(authored.readme.preamble, {
      publishPath: "README.md",
      sourceLabel: "site/docs/README.md",
      publishedPaths,
      base,
    }),
  };
  for (const [dir, dirReadme] of authored.dirReadmes) {
    authored.dirReadmes.set(dir, {
      ...dirReadme,
      preamble: rewriteAuthoredLinks(dirReadme.preamble, {
        publishPath: `${dir}/README.md`,
        sourceLabel: `site/docs/${dir}/README.md`,
        publishedPaths,
        base,
      }),
    });
  }

  for (const doc of allDocs) await writeDoc({ distDir, doc, base });

  for (const [dir, docs] of byDir) {
    const purpose = authored.indexPurposes.get(dir);
    if (purpose === undefined) continue; // unreachable: already thrown above
    await writeDirectoryIndex({ distDir, dir, purpose, docs, base });
  }

  const spine = allDocs
    .filter((d) => d.kind === "authored" && directoryOf(d.publishPath) === "")
    .toSorted((a, b) => a.publishPath.localeCompare(b.publishPath));

  const deepDirectories: DirectorySection[] = DEEP_DIRS.flatMap((dir) => {
    const purpose = directories.find((d) => d.dir === dir)?.purpose;
    return purpose === undefined ? [] : [{ dir, purpose, docs: byDir.get(dir) ?? [] }];
  });
  const installDir = directories.find((d) => d.dir === "install");
  const devDir = directories.find((d) => d.dir === "dev");

  const installReadme = authored.dirReadmes.get("install") ?? { ...DEFAULT_INSTALL_README, startHere: undefined };
  const install: EntryInput | undefined =
    installDir === undefined
      ? undefined
      : {
          readme: { summary: installReadme.summary, preamble: installReadme.preamble },
          startHere: installReadme.startHere,
          files: byDir.get("install") ?? [],
          also: [],
        };

  const devReadme = authored.dirReadmes.get("dev");
  let dev: EntryInput | undefined;
  if (devReadme !== undefined) {
    const also = DEV_ALSO_DIRS.map((dir) => {
      const purpose = directories.find((d) => d.dir === dir)?.purpose;
      if (purpose === undefined) {
        throw new DocsBuildError(`llms-dev.txt "## Also" needs docs/${dir}/ to be published, but it has none`);
      }
      return { dir, purpose };
    });
    dev = {
      readme: { summary: devReadme.summary, preamble: devReadme.preamble },
      startHere: devReadme.startHere,
      files: byDir.get("dev") ?? [],
      also,
    };
  }

  const summaryLine =
    `docs: ${allDocs.length} doc(s) → dist/docs/ ` +
    `(${promoted.length} promoted, ${generated.docs.length} generated, ${authored.docs.length} authored)` +
    (generated.unresolvedLinks > 0
      ? `\ndocs: ${generated.unresolvedLinks} generated-doc link(s) point at a filename outside the generated set (left as-is)`
      : "");

  return {
    docCount: allDocs.length,
    readme: authored.readme,
    spine,
    deepDirectories,
    installDir,
    devDir,
    install,
    dev,
    summaryLine,
  };
}

