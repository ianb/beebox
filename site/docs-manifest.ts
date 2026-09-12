// Promoted docs (plan: "Sources", "The scrub gate"): repo files listed in
// site/docs-manifest.yaml, admitted only from a hard-coded prefix allowlist.
// Adding a manifest line IS the vetting act; the loader refuses anything
// outside the allowlist regardless of what the manifest says (mirrors the
// closed allowlist site/nuggets.ts already uses).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { rewritePromotedImages, rewritePromotedLinks } from "./docs-links.js";
import { scrubText } from "./docs-scrub.js";
import type { PublishedDoc } from "./docs-types.js";

export class DocsManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsManifestError";
  }
}

const manifestEntrySchema = z
  .object({
    source: z.string().min(1),
    publish: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

const manifestSchema = z.array(manifestEntrySchema);

/** Publish directories a manifest entry may target. Closed set. */
const ADMISSIBLE_PUBLISH_DIRS = [
  "capabilities/",
  "concepts/",
  "install/",
  "security/",
  "architecture/",
  "design/",
  "compared/",
  "contracts/",
  "dev/",
] as const;

/** Individual repo files admitted as manifest sources, beyond the prefix rules below. Closed set. */
const ADMISSIBLE_SOURCE_FILES: readonly string[] = ["CONTRIBUTING.md", "beebox/CLAUDE.md", "beebox/code-style.md", "beebox/frontend.md"];

// A repo-relative posix path with no traversal: the prefix checks below run on
// the literal string, so `beebox/docs/design/../../issues/x.md` must be refused
// here rather than pass as "under design/" and then read an internal file.
function isPlainRelativePath(p: string): boolean {
  if (p === "" || p.startsWith("/") || p.includes("\\")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

function isAdmissibleSource(source: string): boolean {
  if (!isPlainRelativePath(source)) return false;
  if (source === "README.md") return true;
  if (ADMISSIBLE_SOURCE_FILES.includes(source)) return true;
  if (source.startsWith("beebox/docs/design/")) return true;
  if (source.startsWith("beebox/docs/architecture/")) return true;
  return /^beebox\/docs\/[^/]+\.md$/.test(source);
}

function isAdmissiblePublish(publish: string): boolean {
  if (!isPlainRelativePath(publish) || !publish.endsWith(".md")) return false;
  return ADMISSIBLE_PUBLISH_DIRS.some((dir) => publish.startsWith(dir));
}

/**
 * Read and validate `site/docs-manifest.yaml`. A missing file is legal (an
 * empty starter set); a malformed file, or an entry outside either allowlist,
 * fails the build.
 */
export function loadManifestEntries(manifestPath: string): ManifestEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (_e) {
    return [];
  }
  const parsedYaml: unknown = YAML.parse(raw);
  const result = manifestSchema.safeParse(parsedYaml);
  if (!result.success) {
    throw new DocsManifestError(`${path.basename(manifestPath)}: invalid manifest: ${result.error.message}`);
  }
  for (const entry of result.data) {
    if (!isAdmissibleSource(entry.source)) {
      throw new DocsManifestError(
        `${path.basename(manifestPath)}: source "${entry.source}" is outside the admissible prefixes ` +
          "(beebox/docs/<flat file>.md, beebox/docs/design/, beebox/docs/architecture/, root README.md, " +
          `${ADMISSIBLE_SOURCE_FILES.join(", ")})`,
      );
    }
    if (!isAdmissiblePublish(entry.publish)) {
      throw new DocsManifestError(
        `${path.basename(manifestPath)}: publish path "${entry.publish}" is outside the admissible directories ` +
          `(${ADMISSIBLE_PUBLISH_DIRS.join(", ")})`,
      );
    }
  }
  return result.data;
}

/** Read, scrub, and link-rewrite every promoted doc; copy any images it references. */
export function loadPromotedDocs(params: { entries: ManifestEntry[]; repoRoot: string; base: string }): PublishedDoc[] {
  const { entries, repoRoot, base } = params;
  const byRepoPath = new Map(entries.map((e) => [e.source, e.publish]));
  return entries.map((entry) => {
    const abs = path.join(repoRoot, entry.source);
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new DocsManifestError(`${entry.source}: cannot read promoted source: ${detail}`);
    }
    scrubText(content, { sourceLabel: entry.source, repoRoot, blocklist: false });
    const withImages = rewritePromotedImages(content, { repoRoot, repoDocPath: entry.source });
    const body = rewritePromotedLinks(withImages, {
      repoRoot,
      repoDocPath: entry.source,
      manifestByRepoPath: byRepoPath,
      base,
    });
    return { publishPath: entry.publish, kind: "promoted", description: entry.description, body, sourceLabel: entry.source };
  });
}
