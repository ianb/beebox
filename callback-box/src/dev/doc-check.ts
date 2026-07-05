#!/usr/bin/env node --import tsx
/**
 * Documentation enforcement (`pnpm doc-check`): exits nonzero on broken
 * references anywhere, or on orphaned docs in the live reference area
 * (flat docs/, architecture/, scheduled/ — the plans taxonomy and
 * reports/ are archives and exempt). Run by the monorepo pre-commit hook
 * for any commit touching .md files. Prints nothing on success.
 *
 * Naming/placement conventions: docs/README.md.
 */

import { buildGraphExtended } from "./doc-graph-data.js";

// Example-syntax lines the extractor can't distinguish from real refs.
// Format: "<from> -> <target>". Keep each entry justified.
const ALLOWED_BROKEN = new Set([
  // Describes the @MAP.md include syntax a box's context_dir provides.
  "docs/knowledge-audits.md -> MAP.md",
  // Frozen record quoting the broken-link example it was written about.
  "docs/implemented-plans/link-validation-fix.md -> /store/foo/bar.md",
]);

// Frozen point-in-time snapshots: their refs were valid at freeze time and
// are not maintained.
const BROKEN_EXEMPT_PREFIXES = ["docs/reports/"];

const ORPHAN_EXEMPT_PREFIXES = [
  "docs/plans/",
  "docs/implemented-plans/",
  "docs/unimplemented-plans/",
  "docs/reports/",
];

const { docs, externalRefs } = buildGraphExtended();
const problems: string[] = [];

for (const doc of docs.values()) {
  if (BROKEN_EXEMPT_PREFIXES.some((p) => doc.path.startsWith(p))) continue;
  for (const ref of doc.outgoing) {
    if (!ref.resolved && !ALLOWED_BROKEN.has(`${doc.path} -> ${ref.target}`)) {
      problems.push(`broken ref: ${doc.path}:${ref.line} -> ${ref.target}`);
    }
  }
}
for (const ref of externalRefs) {
  if (!ref.resolved && !ALLOWED_BROKEN.has(`${ref.from} -> ${ref.target}`)) {
    problems.push(`broken ref: ${ref.from}:${ref.line} -> ${ref.target}`);
  }
}

for (const doc of docs.values()) {
  if (!doc.path.startsWith("docs/")) continue;
  if (ORPHAN_EXEMPT_PREFIXES.some((p) => doc.path.startsWith(p))) continue;
  if (doc.path.endsWith("README.md") || doc.path === "docs/doc-graph.md") continue;
  if (doc.incoming.length === 0) {
    problems.push(`orphan: ${doc.path} — nothing links to it; add a pointer (CLAUDE.md Guides table, a related doc, or a skill) or move it to an archive dir`);
  }
}

if (problems.length > 0) {
  console.error("doc-check failed:");
  for (const p of problems) console.error(`  ${p}`);
  console.error("After fixing, regenerate the index: pnpm doc-graph. Conventions: docs/README.md.");
  process.exit(1);
}
