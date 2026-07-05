/**
 * Shared data layer for documentation graph reports.
 *
 * Walks the repo for .md files, extracts cross-references, and exposes the
 * resulting graph for emitters (markdown report, HTML showcase, etc.).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../lib/package-root.js";

export const ROOT = PACKAGE_ROOT;

// Output paths of report emitters. Their contents quote other files verbatim,
// so extracting references from them would falsely inflate incoming counts.
const EMITTER_OUTPUTS = new Set(["docs/doc-graph.md", "docs/doc-graph.html"]);

const EXCLUDE_DIRS = ["node_modules", ".tap", ".thinking", ".claude", "dist", "src/dev/reports"];
const EXCLUDE_PATTERNS = [/\.doctest\.md$/];

export interface Reference {
  from: string;
  target: string;
  resolved: boolean;
  context: string;
  line: number;
  type: "link" | "at-include" | "mention";
}

export interface DocInfo {
  path: string;
  title: string;
  lineCount: number;
  mtimeMs: number;
  outgoing: Reference[];
  incoming: Reference[];
}

function findMarkdownFiles(): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = path.relative(ROOT, path.join(dir, entry.name));
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        if (EXCLUDE_DIRS.some((ex) => rel === ex || rel.startsWith(ex + "/"))) continue;
        if (entry.name.startsWith(".")) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith(".md")) {
        if (EXCLUDE_PATTERNS.some((p) => p.test(entry.name))) continue;
        results.push(rel);
      }
    }
  }
  walk(ROOT);
  return results.toSorted();
}

// Monorepo-level locations whose .md files are reference SOURCES: their
// outgoing refs count toward callback-box docs' incoming (so a doc cited only
// from a skill or the root CLAUDE.md is not an orphan), but they are not
// documents in the graph themselves. Paths relative to the monorepo root.
const EXTERNAL_SOURCE_ROOTS = ["CLAUDE.md", "bin", "dev", "research", "issues", ".claude"];

function findExternalSourceFiles(monoRoot: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith(".md") && !EXCLUDE_PATTERNS.some((p) => p.test(entry.name))) {
        results.push(path.relative(monoRoot, path.join(dir, entry.name)));
      }
    }
  }
  for (const root of EXTERNAL_SOURCE_ROOTS) {
    const abs = path.join(monoRoot, root);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) walk(abs);
    else results.push(root);
  }
  return results.toSorted();
}

// Refs written outside callback-box name their targets callback-box-relative
// ("docs/testing.md"), monorepo-relative ("callback-box/docs/testing.md",
// "bin/CLAUDE.md"), or relative to the citing file. Internal resolutions
// return the ROOT-relative path (so incoming counts attach); external
// resolutions return "../<monorepo-relative>" and just mean "not broken".
interface ExternalResolveContext {
  fromFile: string;
  internalFiles: string[];
  externalFiles: string[];
  internalBasenames: Map<string, string[]>;
  externalBasenames: Map<string, string[]>;
}

function resolveExternalRef(ref: string, ctx: ExternalResolveContext): [string, boolean] {
  const cleaned = ref.replace(/#.*$/, "").trim().replace(/^\.\//, "");
  if (!cleaned.endsWith(".md")) return [ref, false];

  const asInternal = path.normalize(cleaned.replace(/^callback-box\//, ""));
  if (ctx.internalFiles.includes(asInternal)) return [asInternal, true];

  if (ctx.externalFiles.includes(path.normalize(cleaned))) return ["../" + path.normalize(cleaned), true];

  const fromDir = path.dirname(ctx.fromFile);
  const asRelative = path.normalize(path.join(fromDir, cleaned));
  if (ctx.externalFiles.includes(asRelative)) return ["../" + asRelative, true];
  const relativeInternal = asRelative.replace(/^callback-box\//, "");
  if (ctx.internalFiles.includes(relativeInternal)) return [relativeInternal, true];

  const base = path.basename(cleaned);
  const internal = ctx.internalBasenames.get(base);
  if (internal && internal.length === 1) return [internal[0] as string, true];
  const external = ctx.externalBasenames.get(base);
  if (external && external.length === 1) return ["../" + (external[0] as string), true];

  return [cleaned, false];
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)/m);
  return match && match[1] ? match[1].trim() : "(no title)";
}

function buildBasenameLookup(files: string[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  for (const f of files) {
    const base = path.basename(f);
    const existing = lookup.get(base);
    if (existing) {
      existing.push(f);
    } else {
      lookup.set(base, [f]);
    }
  }
  return lookup;
}

interface ResolveContext {
  fromFile: string;
  allFiles: string[];
  basenameLookup: Map<string, string[]>;
}

// URI-scheme targets (https://..., view:...) are not file references.
function hasUriScheme(ref: string): boolean {
  return /^[a-z][\d+.a-z-]*:/i.test(ref);
}

function resolveRef(ref: string, { fromFile, allFiles, basenameLookup }: ResolveContext): [string, boolean] {
  const cleaned = ref.replace(/#.*$/, "").trim();
  if (!cleaned) return [ref, false];
  if (!cleaned.endsWith(".md")) return [ref, false];

  const fromDir = path.dirname(fromFile);
  const asRelative = path.normalize(path.join(fromDir, cleaned));
  if (allFiles.includes(asRelative)) return [asRelative, true];

  const asRoot = path.normalize(cleaned.replace(/^\.\//, ""));
  if (allFiles.includes(asRoot)) return [asRoot, true];

  // A ../-relative path may legitimately leave callback-box for a
  // monorepo-level file (a skill, memory, research); resolve on disk.
  if (cleaned.startsWith("../")) {
    const monoRoot = path.dirname(ROOT);
    const abs = path.normalize(path.join(ROOT, fromDir, cleaned));
    if (abs.startsWith(monoRoot + path.sep) && fs.existsSync(abs)) {
      return ["../" + path.relative(monoRoot, abs), true];
    }
  }

  const base = path.basename(cleaned);
  const matches = basenameLookup.get(base);
  const first = matches && matches.length === 1 ? matches[0] : null;
  if (first) return [first, true];

  return [cleaned, false];
}

function extractReferences(
  filePath: string,
  {
    content,
    allFiles,
    basenameLookup,
    resolve,
  }: {
    content: string;
    allFiles: string[];
    basenameLookup: Map<string, string[]>;
    resolve?: (ref: string) => [string, boolean];
  },
): Reference[] {
  const refs: Reference[] = [];
  const lines = content.split("\n");
  const seen = new Set<string>();
  const doResolve = resolve ?? ((ref: string) => resolveRef(ref, { fromFile: filePath, allFiles, basenameLookup }));

  for (const [i, line] of lines.entries()) {
    const lineNum = i + 1;

    const linkRegex = /\[([^\]]*)]\(([^)]+\.md(?:#[^)]*)?)\)/g;
    let match;
    while ((match = linkRegex.exec(line)) !== null) {
      const rawTarget = match[2] as string;
      if (hasUriScheme(rawTarget)) continue;
      const [target, resolved] = doResolve(rawTarget);
      const key = `${filePath}:${target}:link`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ from: filePath, target, resolved, context: line.trim(), line: lineNum, type: "link" });
      }
    }

    const atRegex = /@([\w.-]+\.md)\b/g;
    while ((match = atRegex.exec(line)) !== null) {
      const rawTarget = match[1] as string;
      const [target, resolved] = doResolve(rawTarget);
      const key = `${filePath}:${target}:at-include`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ from: filePath, target, resolved, context: line.trim(), line: lineNum, type: "at-include" });
      }
    }

    const mentionRegex = /(?:`|(?:^|[\s(]))(([\w./-]+\.md)(?:#[\w-]*)?)/g;
    while ((match = mentionRegex.exec(line)) !== null) {
      const rawTarget = match[2] as string;
      const [target, resolved] = doResolve(rawTarget);
      const key = `${filePath}:${target}`;
      const alreadyCaptured = [...seen].some((s) => s.startsWith(key));
      if (!alreadyCaptured && resolved) {
        seen.add(`${key}:mention`);
        refs.push({ from: filePath, target, resolved, context: line.trim(), line: lineNum, type: "mention" });
      }
    }
  }

  return refs;
}

export function buildGraphExtended(): { docs: Map<string, DocInfo>; externalRefs: Reference[] } {
  const files = findMarkdownFiles();
  const basenameLookup = buildBasenameLookup(files);
  const docs = new Map<string, DocInfo>();

  for (const f of files) {
    const abs = path.join(ROOT, f);
    const content = fs.readFileSync(abs, "utf-8");
    const stat = fs.statSync(abs);
    docs.set(f, {
      path: f,
      title: extractTitle(content),
      lineCount: content.split("\n").length,
      mtimeMs: stat.mtimeMs,
      outgoing: [],
      incoming: [],
    });
  }

  for (const [filePath, doc] of docs) {
    if (EMITTER_OUTPUTS.has(filePath)) continue;
    const content = fs.readFileSync(path.join(ROOT, filePath), "utf-8");
    doc.outgoing = extractReferences(filePath, { content, allFiles: files, basenameLookup });
  }

  for (const doc of docs.values()) {
    for (const ref of doc.outgoing) {
      if (ref.resolved) {
        const targetDoc = docs.get(ref.target);
        if (targetDoc) targetDoc.incoming.push(ref);
      }
    }
  }

  // Monorepo-level sources (skills, root/bin CLAUDE.md, research/, dev/):
  // their refs count toward incoming so skill-cited docs aren't orphans.
  const externalRefs: Reference[] = [];
  const monoRoot = path.dirname(ROOT);
  if (fs.existsSync(path.join(monoRoot, "callback-box", "package.json"))) {
    const externalFiles = findExternalSourceFiles(monoRoot);
    const externalBasenames = buildBasenameLookup(externalFiles);
    for (const rel of externalFiles) {
      const content = fs.readFileSync(path.join(monoRoot, rel), "utf-8");
      const from = "../" + rel;
      const refs = extractReferences(from, {
        content,
        allFiles: files,
        basenameLookup,
        resolve: (ref) =>
          resolveExternalRef(ref, {
            fromFile: rel,
            internalFiles: files,
            externalFiles,
            internalBasenames: basenameLookup,
            externalBasenames,
          }),
      });
      externalRefs.push(...refs);
      for (const ref of refs) {
        if (ref.resolved) docs.get(ref.target)?.incoming.push(ref);
      }
    }
  }

  return { docs, externalRefs };
}

export function buildGraph(): Map<string, DocInfo> {
  return buildGraphExtended().docs;
}
