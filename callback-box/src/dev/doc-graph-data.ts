/**
 * Shared data layer for documentation graph reports.
 *
 * Walks the repo for .md files, extracts cross-references, and exposes the
 * resulting graph for emitters (markdown report, HTML showcase, etc.).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");

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

function resolveRef(ref: string, { fromFile, allFiles, basenameLookup }: ResolveContext): [string, boolean] {
  const cleaned = ref.replace(/#.*$/, "").trim();
  if (!cleaned) return [ref, false];
  if (!cleaned.endsWith(".md")) return [ref, false];

  const fromDir = path.dirname(fromFile);
  const asRelative = path.normalize(path.join(fromDir, cleaned));
  if (allFiles.includes(asRelative)) return [asRelative, true];

  const asRoot = path.normalize(cleaned.replace(/^\.\//, ""));
  if (allFiles.includes(asRoot)) return [asRoot, true];

  const base = path.basename(cleaned);
  const matches = basenameLookup.get(base);
  const first = matches && matches.length === 1 ? matches[0] : null;
  if (first) return [first, true];

  return [cleaned, false];
}

function extractReferences(
  filePath: string,
  { content, allFiles, basenameLookup }: { content: string; allFiles: string[]; basenameLookup: Map<string, string[]> },
): Reference[] {
  const refs: Reference[] = [];
  const lines = content.split("\n");
  const seen = new Set<string>();

  for (const [i, line] of lines.entries()) {
    const lineNum = i + 1;

    const linkRegex = /\[([^\]]*)]\(([^)]+\.md(?:#[^)]*)?)\)/g;
    let match;
    while ((match = linkRegex.exec(line)) !== null) {
      const rawTarget = match[2] as string;
      const [target, resolved] = resolveRef(rawTarget, { fromFile: filePath, allFiles, basenameLookup });
      const key = `${filePath}:${target}:link`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ from: filePath, target, resolved, context: line.trim(), line: lineNum, type: "link" });
      }
    }

    const atRegex = /@([\w.-]+\.md)\b/g;
    while ((match = atRegex.exec(line)) !== null) {
      const rawTarget = match[1] as string;
      const [target, resolved] = resolveRef(rawTarget, { fromFile: filePath, allFiles, basenameLookup });
      const key = `${filePath}:${target}:at-include`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ from: filePath, target, resolved, context: line.trim(), line: lineNum, type: "at-include" });
      }
    }

    const mentionRegex = /(?:`|(?:^|[\s(]))(([\w./-]+\.md)(?:#[\w-]*)?)/g;
    while ((match = mentionRegex.exec(line)) !== null) {
      const rawTarget = match[2] as string;
      const [target, resolved] = resolveRef(rawTarget, { fromFile: filePath, allFiles, basenameLookup });
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

export function buildGraph(): Map<string, DocInfo> {
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

  return docs;
}
