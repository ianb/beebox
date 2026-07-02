/**
 * Repair broken internal markdown links by finding the target elsewhere in the
 * box. For each broken link (one CB002 would flag) we look for a file or
 * directory with the same basename:
 *
 *   - exactly one match  → unambiguous, rewrite the link (box-root-absolute)
 *   - several matches     → disambiguate by the longest shared trailing path
 *                           suffix; a unique winner is still rewritten
 *   - still tied / none   → reported for an agent (or the boxholder) to resolve
 *
 * The mechanical, single-answer case is fixed automatically; every genuinely
 * ambiguous case becomes a report, not a guess — arrange the context, don't
 * automate the judgment.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { listBoxMarkdownFiles } from "./list-cards.js";
import { extractInlineLinks, resolveInternalLink } from "./markdown-lint-rules.js";
import { fileExists } from "../lib/file-exists.js";

const INDEX_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.pnpm/**",
  "**/.claude/**",
  "**/.callback-box/**",
  "docs/generated/**",
];

export type RepairStatus = "fixed" | "ambiguous" | "unresolvable";

export interface Repair {
  /** Box-relative path of the file containing the link. */
  file: string;
  lineNumber: number;
  oldUrl: string;
  status: RepairStatus;
  /** The chosen replacement (box-root-absolute), present only when fixed. */
  newUrl?: string;
  /** Box-root-absolute candidate targets (for ambiguous: the tied options). */
  candidates: string[];
}

export interface RepairReport {
  fixed: Repair[];
  ambiguous: Repair[];
  unresolvable: Repair[];
}

/** Number of trailing path segments two box-relative paths share. */
function trailingSuffixScore(a: string, b: string): number {
  const ra = a.split("/").toReversed();
  const rb = b.split("/").toReversed();
  let n = 0;
  while (n < ra.length && n < rb.length && ra[n] === rb[n]) n++;
  return n;
}

/** basename → box-relative paths of every file and directory in the box. */
async function buildBasenameIndex(root: string): Promise<Map<string, string[]>> {
  const entries = await glob("**", { cwd: root, ignore: INDEX_IGNORE, dot: false, nodir: false });
  const index = new Map<string, string[]>();
  for (const rel of entries) {
    const base = path.basename(rel);
    const bucket = index.get(base);
    if (bucket) bucket.push(rel);
    else index.set(base, [rel]);
  }
  return index;
}

/** Box-root-absolute form (`/store/...`) of a box-relative path, plus fragment. */
function toBoxAbsolute(rel: string, fragment: string): string {
  return `/${rel}${fragment}`;
}

/** Decide how (or whether) to repair one broken link. */
function decideRepair(oldUrl: string, index: Map<string, string[]>): {
  status: RepairStatus;
  newUrl?: string;
  candidates: string[];
} {
  const hashAt = oldUrl.indexOf("#");
  const targetPath = (hashAt === -1 ? oldUrl : oldUrl.slice(0, hashAt)).replace(/^\/+/, "");
  const fragment = hashAt === -1 ? "" : oldUrl.slice(hashAt);
  const basename = path.basename(targetPath);
  const matches = index.get(basename) ?? [];

  if (matches.length === 0) return { status: "unresolvable", candidates: [] };
  if (matches.length === 1) {
    return { status: "fixed", newUrl: toBoxAbsolute(matches[0]!, fragment), candidates: [] };
  }

  // Several files share the basename — prefer the one whose path best lines up
  // with the (stale) link, by trailing-segment overlap. A unique top score wins.
  const scored = matches.map((rel) => ({ rel, score: trailingSuffixScore(targetPath, rel) }));
  const top = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === top);
  if (winners.length === 1) {
    return { status: "fixed", newUrl: toBoxAbsolute(winners[0]!.rel, fragment), candidates: [] };
  }
  return {
    status: "ambiguous",
    candidates: matches.map((rel) => toBoxAbsolute(rel, "")).toSorted(),
  };
}

/**
 * Scan the box for broken internal markdown links and repair the unambiguous
 * ones (unless dryRun). Returns a report partitioned into fixed / ambiguous /
 * unresolvable.
 */
export async function repairBoxLinks(
  boxRoot: string,
  { dryRun }: { dryRun: boolean }
): Promise<RepairReport> {
  const root = path.resolve(boxRoot);
  const index = await buildBasenameIndex(root);
  const report: RepairReport = { fixed: [], ambiguous: [], unresolvable: [] };

  for (const file of await listBoxMarkdownFiles(root)) {
    const original = await fs.readFile(file, "utf-8");
    const fileDir = path.dirname(file);
    const rel = path.relative(root, file);
    const replacements: Array<{ oldUrl: string; newUrl: string }> = [];

    for (const link of extractInlineLinks(original.split("\n"))) {
      const res = resolveInternalLink(link.url, { fileDir, boxRoot: root });
      if (!res.internal) continue;
      if (res.inside && (await fileExists(res.resolved))) continue; // link is fine

      const decision = decideRepair(link.url, index);
      const base = { file: rel, lineNumber: link.lineNumber, oldUrl: link.url };
      if (decision.status === "fixed" && decision.newUrl !== undefined) {
        replacements.push({ oldUrl: link.url, newUrl: decision.newUrl });
        report.fixed.push({ ...base, status: "fixed", newUrl: decision.newUrl, candidates: [] });
      } else if (decision.status === "ambiguous") {
        report.ambiguous.push({ ...base, status: "ambiguous", candidates: decision.candidates });
      } else {
        report.unresolvable.push({ ...base, status: "unresolvable", candidates: [] });
      }
    }

    if (replacements.length > 0 && !dryRun) {
      let updated = original;
      for (const { oldUrl, newUrl } of replacements) {
        updated = updated.split(`](${oldUrl})`).join(`](${newUrl})`);
      }
      await fs.writeFile(file, updated);
    }
  }

  return report;
}
