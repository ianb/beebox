#!/usr/bin/env node --import tsx
/**
 * Documentation graph generator.
 *
 * Finds all .md files in the project, extracts cross-references between them,
 * and generates a report highlighting issues (orphans, broken links, ambiguous
 * descriptions) and a full inventory.
 *
 * Usage: npx tsx src/dev/doc-graph.ts > docs/doc-graph.md
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

// --- File discovery ---

const EXCLUDE_DIRS = ["node_modules", ".tap", ".thinking", ".claude", "dist", "src/dev/reports"];
const EXCLUDE_PATTERNS = [/\.doctest\.md$/];

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

// --- Reference extraction ---

interface Reference {
  /** The file that contains this reference */
  from: string;
  /** The file being referenced (resolved path, or raw string if unresolved) */
  target: string;
  /** Whether the target resolved to an actual file */
  resolved: boolean;
  /** The line containing the reference (trimmed) */
  context: string;
  /** Line number */
  line: number;
  /** Type of reference */
  type: "link" | "at-include" | "mention";
}

interface DocInfo {
  path: string;
  title: string;
  lineCount: number;
  outgoing: Reference[];
  incoming: Reference[];
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)/m);
  return match && match[1] ? match[1].trim() : "(no title)";
}

/**
 * Build a lookup from basename -> full path(s).
 * Files with unique basenames can be matched by basename alone.
 */
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

/**
 * Try to resolve a reference string to a known file path.
 * Returns [resolvedPath, true] or [originalRef, false].
 */
interface ResolveContext {
  fromFile: string;
  allFiles: string[];
  basenameLookup: Map<string, string[]>;
}

function resolveRef(
  ref: string,
  { fromFile, allFiles, basenameLookup }: ResolveContext
): [string, boolean] {
  // Strip any anchor
  const cleaned = ref.replace(/#.*$/, "").trim();
  if (!cleaned) return [ref, false];
  if (!cleaned.endsWith(".md")) return [ref, false];

  // Try as relative path from the referencing file
  const fromDir = path.dirname(fromFile);
  const asRelative = path.normalize(path.join(fromDir, cleaned));
  if (allFiles.includes(asRelative)) return [asRelative, true];

  // Try as path from project root
  const asRoot = path.normalize(cleaned.replace(/^\.\//, ""));
  if (allFiles.includes(asRoot)) return [asRoot, true];

  // Try basename match
  const base = path.basename(cleaned);
  const matches = basenameLookup.get(base);
  const first = matches && matches.length === 1 ? matches[0] : null;
  if (first) return [first, true];

  return [cleaned, false];
}

function extractReferences(
  filePath: string,
  { content, allFiles, basenameLookup }: { content: string; allFiles: string[]; basenameLookup: Map<string, string[]> }
): Reference[] {
  const refs: Reference[] = [];
  const lines = content.split("\n");
  const seen = new Set<string>();

  for (const [i, line] of lines.entries()) {
    const lineNum = i + 1;

    // Markdown links: [text](path.md) or [text](path.md#anchor)
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

    // @-includes: @FILENAME.md (CLAUDE.md convention)
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

    // Prose mentions: backtick-quoted or bare references to .md files
    // Match things like `docs/testing.md` or docs/testing.md in prose
    const mentionRegex = /(?:`|(?:^|[\s(]))(([\w./-]+\.md)(?:#[\w-]*)?)/g;
    while ((match = mentionRegex.exec(line)) !== null) {
      const rawTarget = match[2] as string;
      // Skip if this was already captured as a link or @-include
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

// --- Report generation ---

function generateReport(docs: Map<string, DocInfo>): string {
  const lines: string[] = [];

  lines.push("# Documentation Graph Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString().slice(0, 19)}Z`);
  lines.push(`Total documents: ${docs.size}`);
  lines.push("");

  // --- Issues section ---
  const orphans = [...docs.values()].filter((d) => d.incoming.length === 0);
  const brokenLinks: Array<{ from: string; ref: Reference }> = [];
  for (const doc of docs.values()) {
    for (const ref of doc.outgoing) {
      if (!ref.resolved) {
        brokenLinks.push({ from: doc.path, ref });
      }
    }
  }

  const hasIssues = orphans.length > 0 || brokenLinks.length > 0;

  if (hasIssues) {
    lines.push("## Issues");
    lines.push("");
  }

  if (orphans.length > 0) {
    lines.push("### Orphaned Documents (no incoming references)");
    lines.push("");
    lines.push("These documents are not referenced by any other document.");
    lines.push("");
    for (const doc of orphans) {
      lines.push(`- **${doc.path}** — "${doc.title}" (${doc.lineCount} lines)`);
    }
    lines.push("");
  }

  if (brokenLinks.length > 0) {
    lines.push("### Broken References");
    lines.push("");
    lines.push("These references point to files that don't exist.");
    lines.push("");
    for (const { from, ref } of brokenLinks) {
      lines.push(`- **${from}:${ref.line}** → \`${ref.target}\` (${ref.type})`);
      lines.push(`  Context: ${ref.context.slice(0, 120)}`);
    }
    lines.push("");
  }

  // --- Full inventory ---
  lines.push("## Document Inventory");
  lines.push("");

  // Group by directory
  const byDir = new Map<string, DocInfo[]>();
  for (const doc of docs.values()) {
    const dir = path.dirname(doc.path);
    const existing = byDir.get(dir);
    if (existing) {
      existing.push(doc);
    } else {
      byDir.set(dir, [doc]);
    }
  }

  for (const [dir, dirDocs] of [...byDir.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${dir}/`);
    lines.push("");

    for (const doc of dirDocs.toSorted((a, b) => a.path.localeCompare(b.path))) {
      const isOrphan = doc.incoming.length === 0;
      const orphanTag = isOrphan ? " **[ORPHAN]**" : "";
      lines.push(`#### ${doc.path}${orphanTag}`);
      lines.push("");
      lines.push(`Title: "${doc.title}" | ${doc.lineCount} lines`);
      lines.push("");

      if (doc.incoming.length > 0) {
        lines.push("Referenced by:");
        for (const ref of doc.incoming) {
          const desc = ref.context.slice(0, 120);
          lines.push(`- ${ref.from}:${ref.line} (${ref.type}) — ${desc}`);
        }
        lines.push("");
      }

      if (doc.outgoing.length > 0) {
        lines.push("References:");
        for (const ref of doc.outgoing) {
          const status = ref.resolved ? "" : " **[BROKEN]**";
          lines.push(`- → ${ref.target} (${ref.type})${status}`);
        }
        lines.push("");
      }

      if (doc.incoming.length === 0 && doc.outgoing.length === 0) {
        lines.push("No references in or out.");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

// --- Main ---

const files = findMarkdownFiles();
const basenameLookup = buildBasenameLookup(files);
const docs = new Map<string, DocInfo>();

// First pass: read files, extract titles
for (const f of files) {
  const content = fs.readFileSync(path.join(ROOT, f), "utf-8");
  docs.set(f, {
    path: f,
    title: extractTitle(content),
    lineCount: content.split("\n").length,
    outgoing: [],
    incoming: [],
  });
}

// Second pass: extract references
for (const [filePath, doc] of docs) {
  const content = fs.readFileSync(path.join(ROOT, filePath), "utf-8");
  doc.outgoing = extractReferences(filePath, { content, allFiles: files, basenameLookup });
}

// Third pass: build incoming references
for (const doc of docs.values()) {
  for (const ref of doc.outgoing) {
    if (ref.resolved) {
      const targetDoc = docs.get(ref.target);
      if (targetDoc) {
        targetDoc.incoming.push(ref);
      }
    }
  }
}

// Generate and output
const report = generateReport(docs);
process.stdout.write(report + "\n");
