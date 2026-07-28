/**
 * Pure filename + summary formatting for bulk-upload batch preparation.
 *
 * Split out of `prepare.ts` to keep it under the line cap. Deterministic over
 * their inputs so an idempotent re-run of prepare yields identical stored names
 * and the same summary line.
 */

import { humanBytes } from "../../lib/human-bytes.js";

/**
 * Sanitize a client-claimed filename to a safe on-disk name, preserving the
 * extension. Strips any path components and collapses unsafe characters to `-`.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  const rawStem = dot > 0 ? base.slice(0, dot) : base;
  const rawExt = dot > 0 ? base.slice(dot + 1) : "";
  const stem = rawStem
    .replace(/[^\w.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const ext = rawExt.replace(/[^\dA-Za-z]/g, "");
  const safeStem = stem.length > 0 ? stem : "file";
  return ext.length > 0 ? `${safeStem}.${ext}` : safeStem;
}

/** Dedupe a filename against `used`, inserting `-2`, `-3`, … before the extension. */
export function dedupeName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  let candidate = `${stem}-${n}${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem}-${n}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/** Short human summary for the card body + the `<upload>` wrapper body. */
export function summarizeBatch(opts: {
  received: number;
  missing: number;
  failed: number;
  totalBytes: number;
}): string {
  const parts = [`${String(opts.received)} file${opts.received === 1 ? "" : "s"} uploaded (${humanBytes(opts.totalBytes)})`];
  if (opts.missing > 0) parts.push(`${String(opts.missing)} missing`);
  if (opts.failed > 0) parts.push(`${String(opts.failed)} failed`);
  return `${parts.join("; ")}.`;
}
