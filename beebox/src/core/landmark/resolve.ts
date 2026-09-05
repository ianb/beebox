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
import type {
  LandmarkExpandData,
  LandmarkNavigationData,
  LandmarkOrderType,
} from "../../schemas/landmark.js";
import { isCardFile } from "../../lib/paths.js";
import { resolveBoxNamespacePathOnDisk } from "../../lib/box-namespace-resolve.js";
import { parseRef, resolveRefPath } from "../../shared/ref-path.js";
import { titleFromFilename } from "../file-summary.js";
import { lookupField, loadCardFrontmatter } from "../frontmatter-field.js";

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

/**
 * A named `expand` rendered as a collapsible submenu. `count` is the total
 * number of matches; `children` may be capped (see GROUP_CHILD_CAP), in
 * which case `count > children.length` and the surface notes the overflow.
 */
export interface ResolvedGroup {
  /** Submenu title (the expand's `group`). */
  label: string;
  /** Resolved child links, capped at GROUP_CHILD_CAP. */
  children: ResolvedLink[];
  /** Total match count (may exceed `children.length` when capped). */
  count: number;
}

/** Flat links plus named groups for one landmark's navigation role. */
export interface ResolvedNavigation {
  /** Static links + unnamed expands, deduped, in source order. */
  links: ResolvedLink[];
  /** Named expands, each kept as a collapsible group. */
  groups: ResolvedGroup[];
}

/**
 * Max child links resolved + shipped per group. The count stays exact; a
 * group with more matches renders its first GROUP_CHILD_CAP children and a
 * "+N more" affordance. Keeps a huge glob from ballooning the wire payload
 * (the `list` endpoint resolves every landmark in the box).
 */
const GROUP_CHILD_CAP = 50;

export interface ResolveOptions {
  /** Absolute path to the landmark card's directory (the `expand` glob's cwd). */
  landmarkDir: string;
  /**
   * Box-relative path of the landmark card itself — the document every `ref`
   * resolves against (see `src/shared/ref-path.ts`).
   */
  landmarkPath: string;
  /** Absolute path to the box root. */
  boxRoot: string;
}

const PLACEHOLDER_RE = /\${([^}]+)}/g;

/**
 * Resolve a landmark's navigation into a flat link list plus named groups.
 *
 * Flat list: hand-listed links come first, then *unnamed* expands;
 * duplicates by ref are dropped (first wins). Each expand carrying a
 * `group` instead becomes a collapsible group, deduped within itself and
 * independent of the flat list. A landmark without a `navigation` role
 * resolves to no links and no groups.
 */
export async function resolveLandmark(
  navigation: LandmarkNavigationData | undefined,
  options: ResolveOptions,
): Promise<ResolvedNavigation> {
  const links: ResolvedLink[] = [];
  const groups: ResolvedGroup[] = [];
  const seen = new Set<string>();
  if (navigation === undefined) return { links, groups };

  for (const link of navigation.links ?? []) {
    if (link.ref === "") continue;
    const resolved = await buildLink({ rawRef: link.ref, label: link.label ?? null, options });
    addUnique(resolved, { out: links, seen });
  }
  for (const expand of navigation.expand ?? []) {
    if (expand.group !== undefined && expand.group !== "") {
      groups.push(await resolveGroup(expand, options));
      continue;
    }
    const expanded = await resolveExpand(expand, options);
    for (const link of expanded.links) addUnique(link, { out: links, seen });
  }
  return { links, groups };
}

/**
 * Resolve a named expand into a group: dedup its children within the group
 * only, cap the resolved children at GROUP_CHILD_CAP, but keep `count`
 * exact (the full match total before capping).
 */
async function resolveGroup(
  expand: LandmarkExpandData,
  options: ResolveOptions,
): Promise<ResolvedGroup> {
  const { links, total } = await resolveExpand(expand, { ...options, limit: GROUP_CHILD_CAP });
  const children: ResolvedLink[] = [];
  const seen = new Set<string>();
  for (const link of links) addUnique(link, { out: children, seen });
  return { label: expand.group ?? "", children, count: total };
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

interface ExpandResult {
  /** Resolved links, capped at `limit` when one is given. */
  links: ResolvedLink[];
  /** Total match count, before any `limit` cap. */
  total: number;
}

async function resolveExpand(
  expand: LandmarkExpandData,
  options: ResolveOptions & { limit?: number },
): Promise<ExpandResult> {
  if (expand.query === "") return { links: [], total: 0 };
  const order = parseOrder(expand.order);
  const matchesRel = await runQuery(expand.query, options.landmarkDir);
  const sorted = await sortMatches(matchesRel, { order, cwd: options.landmarkDir });
  const fenced = await filterFenced(sorted, options);
  const capped = options.limit === undefined ? fenced : fenced.slice(0, options.limit);

  const refTpl = expand["template-ref"];
  const labelTpl = expand["template-label"] ?? "";

  const out: ResolvedLink[] = [];
  for (const matchRel of capped) {
    let frontmatter: Record<string, unknown> | null = null;
    if ((refTpl !== undefined && needsLookup(refTpl)) || needsLookup(labelTpl)) {
      frontmatter = await loadCardFrontmatter(path.join(options.landmarkDir, matchRel));
    }
    const vars: TemplateVars = { matchRel, frontmatter };
    // No `template-ref` → emit the canonical box path (leading `/`) for the
    // match rather than the landmark-dir-relative one the glob returns:
    // generated refs say what they mean regardless of the document they end up
    // read against. An authored template keeps `${path}` dir-relative (that is
    // what the schema documents), and both forms resolve identically below.
    const ref = refTpl === undefined
      ? boxPathForMatch(matchRel, options)
      : applyTemplate(refTpl, vars);
    const label = applyTemplate(labelTpl, vars).trim();
    out.push(await buildLink({
      rawRef: ref,
      label: label.length > 0 ? label : null,
      options,
    }));
  }
  return { links: out, total: fenced.length };
}

/**
 * Reject any glob match whose ON-DISK path (the file the loop above may read
 * for frontmatter, and offer as a match) escapes the box namespace — finding
 * 2 (round 5 hardening). An `expand`'s `query` is an author-controlled glob
 * evaluated with `landmarkDir` as cwd; nothing stopped a pattern like
 * `../src/private.memo.card` (or a symlinked match landing outside the
 * namespace) from matching a file OUTSIDE the landmark's own underscore area,
 * whose frontmatter (title, template fields) would then leak into the
 * rendered label. Every match is re-resolved through
 * `resolveBoxNamespacePathOnDisk` (the same on-disk fence every HTTP/tRPC
 * surface uses) BEFORE it's read or counted; a rejected match is dropped
 * silently rather than surfaced as a broken/missing link, since surfacing it
 * would itself leak that something exists there.
 */
async function filterFenced(matches: string[], options: ResolveOptions): Promise<string[]> {
  const out: string[] = [];
  for (const matchRel of matches) {
    const abs = path.join(options.landmarkDir, matchRel);
    const rawPath = path.relative(options.boxRoot, abs).split(path.sep).join("/");
    const ns = await resolveBoxNamespacePathOnDisk({ boxRoot: options.boxRoot, rawPath, mode: "read" });
    if (ns.ok) out.push(matchRel);
  }
  return out;
}

/**
 * The box path (leading `/`) of one `expand` match, whose glob-relative path is
 * relative to the landmark's directory. Resolved as a literal path
 * (`kind: "markdown"`): a glob match is a filesystem path, so a directory
 * literally named `attach/` is itself, not the landmark's attach scope. Falls
 * back to the raw match if that somehow escapes the box — `buildLink` then
 * reports it missing, the same as any broken ref.
 */
function boxPathForMatch(matchRel: string, options: ResolveOptions): string {
  const resolved = resolveRefPath({
    fromPath: options.landmarkPath,
    ref: matchRel,
    kind: "markdown",
  });
  return resolved === null ? matchRel : `/${resolved}`;
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

/**
 * Resolve one `ref` into a link the client can follow. Resolution goes through
 * the shared ref algebra (`src/shared/ref-path.ts`), so a leading-`/` ref means
 * the box root — the form validate and `bbx mv` already understood, which this
 * layer used to mis-resolve to an OS-absolute path. A `?query`/`#fragment`
 * addresses a location within the target: it's kept on the emitted `ref` but
 * dropped before the existence check. A ref that escapes the box resolves to
 * nothing and is reported missing, the same as a broken ref at validate time.
 */
async function buildLink({ rawRef, label, options }: BuildLinkInput): Promise<ResolvedLink> {
  const parsed = parseRef(rawRef);
  const title = titleFromFilename(parsed.path);
  const resolved = resolveRefPath({
    fromPath: options.landmarkPath,
    ref: parsed.path,
    kind: "card",
  });
  if (resolved === null) return { ref: rawRef, label, title, exists: false };
  const suffix =
    (parsed.query === undefined ? "" : `?${parsed.query}`) +
    (parsed.fragment === undefined ? "" : `#${parsed.fragment}`);
  let exists = false;
  try {
    await fs.stat(path.resolve(options.boxRoot, resolved));
    exists = true;
  } catch (_e) {
    exists = false;
  }
  return { ref: resolved + suffix, label, title, exists };
}
