/**
 * Resolve a landmark element's `<link>` and `<expand>` children into a
 * flat list of links pointing at real (or missing) cards. Used by the
 * landmarks tRPC procedure to ship pre-resolved data to the client.
 *
 * See docs/landmarks.md for semantics (template syntax, dedup, order).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import {
  type ElementNode,
  parseXml,
  evaluateXPathString,
} from "cardworks";
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

type Order = "alphabetical" | "modified-desc" | "modified-asc";

const PLACEHOLDER_RE = /\${([^}]+)}/g;

/**
 * Resolve a landmark element's links. Hand-listed and expanded links merge
 * in source order; duplicates by ref are dropped (first wins).
 */
export async function resolveLandmark(
  element: ElementNode,
  options: ResolveOptions,
): Promise<ResolvedLink[]> {
  const out: ResolvedLink[] = [];
  const seen = new Set<string>();

  for (const child of element.children) {
    if (child.tagName === "link") {
      const link = await resolveHandLink(child, options);
      if (link !== null) addUnique(link, { out, seen });
      continue;
    }
    if (child.tagName === "expand") {
      const expanded = await resolveExpand(child, options);
      for (const link of expanded) addUnique(link, { out, seen });
    }
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

async function resolveHandLink(
  el: ElementNode,
  options: ResolveOptions,
): Promise<ResolvedLink | null> {
  const rawRef = el.attrs["ref"];
  if (typeof rawRef !== "string" || rawRef === "") return null;
  const labelText = typeof el.text === "string" ? el.text.trim() : "";
  return buildLink({
    rawRef,
    label: labelText.length > 0 ? labelText : null,
    options,
  });
}

async function resolveExpand(
  el: ElementNode,
  options: ResolveOptions,
): Promise<ResolvedLink[]> {
  const query = el.attrs["query"];
  if (typeof query !== "string" || query === "") return [];

  const order = parseOrder(el.attrs["order"]);
  const matchesRel = await runQuery(query, options.landmarkDir);
  const sorted = await sortMatches(matchesRel, { order, cwd: options.landmarkDir });


  const templates = el.children.filter((c) => c.tagName === "link");
  const out: ResolvedLink[] = [];

  if (templates.length === 0) {
    for (const matchRel of sorted) {
      out.push(await buildLink({ rawRef: matchRel, label: null, options }));
    }
    return out;
  }

  for (const matchRel of sorted) {
    let matchedRoot: ElementNode | null = null;

    for (const tpl of templates) {
      const refTpl = tpl.attrs["ref"];
      if (typeof refTpl !== "string") continue;
      const labelTpl = typeof tpl.text === "string" ? tpl.text : "";

      if (matchedRoot === null && (needsXPath(refTpl) || needsXPath(labelTpl))) {
        matchedRoot = await loadRoot(path.join(options.landmarkDir, matchRel));
      }

      const vars: TemplateVars = { matchRel, root: matchedRoot };
      const ref = applyTemplate(refTpl, vars);
      const label = applyTemplate(labelTpl, vars).trim();
      out.push(await buildLink({
        rawRef: ref,
        label: label.length > 0 ? label : null,
        options,
      }));
    }
  }
  return out;
}

function needsXPath(template: string): boolean {
  const matches = template.matchAll(PLACEHOLDER_RE);
  for (const m of matches) {
    if (m[1] !== "path") return true;
  }
  return false;
}

interface TemplateVars {
  matchRel: string;
  root: ElementNode | null;
}

function applyTemplate(template: string, vars: TemplateVars): string {
  return template.replace(PLACEHOLDER_RE, (_match, expr: string) => {
    if (expr === "path") return vars.matchRel;
    if (vars.root === null) return "";
    try {
      return evaluateXPathString(expr, vars.root);
    } catch (_e) {
      return "";
    }
  });
}

async function loadRoot(absPath: string): Promise<ElementNode | null> {
  try {
    const content = await fs.readFile(absPath, "utf-8");
    return await parseXml(content, absPath);
  } catch (_e) {
    return null;
  }
}

function parseOrder(value: string | undefined): Order {
  if (value === "modified-desc" || value === "modified-asc" || value === "alphabetical") {
    return value;
  }
  return "alphabetical";
}

async function runQuery(query: string, cwd: string): Promise<string[]> {
  const matches = await glob(query, { cwd, nodir: true });
  return matches.filter((m) => isCardFile(m));
}

interface SortOptions {
  order: Order;
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
