#!/usr/bin/env node --import tsx
/**
 * Documentation graph generator (markdown report).
 *
 * Walks the project's .md files, extracts cross-references, and emits a
 * report highlighting issues (orphans, broken links) plus a full inventory.
 * The HTML showcase variant lives in doc-graph-html.ts.
 *
 * Usage: pnpm doc-graph
 */

import * as path from "node:path";
import { buildGraph, type DocInfo, type Reference } from "./doc-graph-data.js";

function generateReport(docs: Map<string, DocInfo>): string {
  const lines: string[] = [];

  lines.push("# Documentation Graph Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString().slice(0, 19)}Z`);
  lines.push(`Total documents: ${docs.size}`);
  lines.push("");

  const orphans = [...docs.values()].filter((d) => d.incoming.length === 0);
  const brokenLinks: Array<{ from: string; ref: Reference }> = [];
  for (const doc of docs.values()) {
    for (const ref of doc.outgoing) {
      if (!ref.resolved) brokenLinks.push({ from: doc.path, ref });
    }
  }

  if (orphans.length > 0 || brokenLinks.length > 0) {
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

  lines.push("## Document Inventory");
  lines.push("");

  const byDir = new Map<string, DocInfo[]>();
  for (const doc of docs.values()) {
    const dir = path.dirname(doc.path);
    const existing = byDir.get(dir);
    if (existing) existing.push(doc);
    else byDir.set(dir, [doc]);
  }

  for (const [dir, dirDocs] of [...byDir.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${dir}/`);
    lines.push("");

    for (const doc of dirDocs.toSorted((a, b) => a.path.localeCompare(b.path))) {
      const orphanTag = doc.incoming.length === 0 ? " **[ORPHAN]**" : "";
      lines.push(`#### ${doc.path}${orphanTag}`);
      lines.push("");
      lines.push(`Title: "${doc.title}" | ${doc.lineCount} lines`);
      lines.push("");

      if (doc.incoming.length > 0) {
        lines.push("Referenced by:");
        for (const ref of doc.incoming) {
          lines.push(`- ${ref.from}:${ref.line} (${ref.type}) — ${ref.context.slice(0, 120)}`);
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

const docs = buildGraph();
process.stdout.write(generateReport(docs) + "\n");
