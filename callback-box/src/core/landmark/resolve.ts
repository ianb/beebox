/**
 * Resolve a landmark's `navigation` links into a flat list pointing at
 * real (or missing) cards. Used by the landmarks tRPC procedure to ship
 * pre-resolved data to the client.
 *
 * See docs/landmarks.md for semantics (template syntax, dedup, order).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { splitCardContent } from "../../cards/index.js";
import { parse as parseYaml } from "yaml";
import type {
  LandmarkExpandData,
  LandmarkNavigationData,
  LandmarkOrderType,
} from "../../schemas/landmark.js";
import { isCardFile } from "../../cli/lib/paths.js";
import { titleFromFilename } from "../file-summary.js";

export interface ResolvedLink {
  /** Box-relative path to the target card. */
  ref: string;
  /** Explicit landmark label; null means "fall back to title". */
  label: string | null;
  /** Display title for the target (filename-derived for now). */
  title: string;
  /** True if the target file exists on disk. */
  exists: boolean;
}

export interface ResolveOptions {
  /** Absolute path to the landmark card's directory. */
  landmarkDir: string;
  /** Absolute path to the box root. */
  boxRoot: string;
}

const PLACEHOLDER_RE = /\${([^}]+)}/g;

/**
 * Resolve a landmark's navigation links. Hand-listed links come first,
 * then expanded links; duplicates by ref are dropped (first wins). A
 * landmark without a `navigation` role resolves to no links.
 */
export async function resolveLandmark(
  navigation: LandmarkNavigationData | undefined,
  options: ResolveOptions,
): Promise<ResolvedLink[]> {
  const out: ResolvedLink[] = [];
  const seen = new Set<string>();
  if (navigation === undefined) return out;

  for (const link of navigation.links ?? []) {
    if (link.ref === "") continue;
    const resolved = await buildLink({ rawRef: link.ref, label: link.label ?? null, options });
    addUnique(resolved, { out, seen });
  }
  for (const expand of navigation.expand ?? []) {
    const expanded = await resolveExpand(expand, options);
    for (const link of expanded) addUnique(link, { out, seen });
  }
  return out;
}

interface DedupAccumulator {
  out: ResolvedLink[];
  seen: Set<string>;
}

function addUnique(link: ResolvedLink, acc: DedupAccumulator): void {
  if (acc.seen.has(link.ref)) return;
  acc.seen.add(link.ref);
  acc.out.push(link);
}

async function resolveExpand(
  expand: LandmarkExpandData,
  options: ResolveOptions,
): Promise<ResolvedLink[]> {
  if (expand.query === "") return [];
  const order = parseOrder(expand.order);
  const matchesRel = await runQuery(expand.query, options.landmarkDir);
  const sorted = await sortMatches(matchesRel, { order, cwd: options.landmarkDir });

  const refTpl = expand["template-ref"] ?? "${path}";
  const labelTpl = expand["template-label"] ?? "";

  const out: ResolvedLink[] = [];
  for (const matchRel of sorted) {
    let frontmatter: Record<string, unknown> | null = null;
    if (needsLookup(refTpl) || needsLookup(labelTpl)) {
      frontmatter = await loadFrontmatter(path.join(options.landmarkDir, matchRel));
    }
    const vars: TemplateVars = { matchRel, frontmatter };
    const ref = applyTemplate(refTpl, vars);
    const label = applyTemplate(labelTpl, vars).trim();
    out.push(await buildLink({
      rawRef: ref,
      label: label.length > 0 ? label : null,
      options,
    }));
  }
  return out;
}

/** True if the template references any field beyond the special `${path}`. */
function needsLookup(template: string): boolean {
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    if (m[1] !== "path") return true;
  }
  return false;
}

interface TemplateVars {
  matchRel: string;
  frontmatter: Record<string, unknown> | null;
}

function applyTemplate(template: string, vars: TemplateVars): string {
  return template.replace(PLACEHOLDER_RE, (_match, expr: string) => {
    if (expr === "path") return vars.matchRel;
    if (vars.frontmatter === null) return "";
    return lookupField(vars.frontmatter, expr);
  });
}

/**
 * Read a dotted field path out of a frontmatter mapping. `${title}` →
 * `frontmatter.title`; `${exif.camera}` walks nested mappings. Missing or
 * non-scalar values render as the empty string. This replaces the old
 * XPath-over-XML evaluation now that cards are YAML frontmatter.
 */
function lookupField(frontmatter: Record<string, unknown>, expr: string): string {
  let cursor: unknown = frontmatter;
  for (const key of expr.split(".")) {
    if (cursor === null || typeof cursor !== "object") return "";
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (cursor === null || cursor === undefined) return "";
  if (typeof cursor === "object") return "";
  return String(cursor);
}

async function loadFrontmatter(absPath: string): Promise<Record<string, unknown> | null> {
  let content: string;
  try {
    content = await fs.readFile(absPath, "utf-8");
  } catch (_e) {
    return null;
  }
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    return null;
  }
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return null;
  return fm as Record<string, unknown>;
}

function parseOrder(value: LandmarkOrderType | undefined): LandmarkOrderType {
  return value ?? "alphabetical";
}

async function runQuery(query: string, cwd: string): Promise<string[]> {
  const matches = await glob(query, { cwd, nodir: true });
  return matches.filter((m) => isCardFile(m));
}

interface SortOptions {
  order: LandmarkOrderType;
  cwd: string;
}

async function sortMatches(matches: string[], opts: SortOptions): Promise<string[]> {
  if (opts.order === "alphabetical") return matches.toSorted();

  const stamped: Array<{ relPath: string; mtime: number }> = [];
  for (const m of matches) {
    const abs = path.join(opts.cwd, m);
    try {
      const stat = await fs.stat(abs);
      stamped.push({ relPath: m, mtime: stat.mtimeMs });
    } catch (_e) {
      stamped.push({ relPath: m, mtime: 0 });
    }
  }
  stamped.sort((a, b) =>
    opts.order === "modified-desc" ? b.mtime - a.mtime : a.mtime - b.mtime,
  );
  return stamped.map((x) => x.relPath);
}

interface BuildLinkInput {
  rawRef: string;
  label: string | null;
  options: ResolveOptions;
}

async function buildLink({ rawRef, label, options }: BuildLinkInput): Promise<ResolvedLink> {
  const absolute = path.resolve(options.landmarkDir, rawRef);
  const ref = path.relative(options.boxRoot, absolute);
  let exists = false;
  try {
    await fs.stat(absolute);
    exists = true;
  } catch (_e) {
    exists = false;
  }
  const title = titleFromFilename(rawRef);
  return { ref, label, title, exists };
}
