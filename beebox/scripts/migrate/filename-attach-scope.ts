#!/usr/bin/env tsx

/**
 * Move each legacy media file into its card's attach scope and point the
 * card's `filename.ref` at `attach/<file>`.
 *
 * Old capture archives used a flat layout: `photo-004.jpg` beside
 * `photo-004-<title>.image.card`, with `filename.ref` holding the photo's
 * box-absolute path. Every reader of `filename.ref` accepts only the
 * `attach/<file>` form (`webapp/box-image.ts`, `capture/transcribe-clips.ts`,
 * `commands/pdf-reanalyze.ts`), so those cards showed "Failed to load". A
 * `bbx mv` of such a directory also left the absolute ref pointing at the old
 * directory (fixed since in `rewrite-card-refs.ts`, but the damage stays).
 *
 * Best effort by design (boxholder, 2026-09-18). A card is repaired only when
 * its file is certain; see {@link classifyFilenameRefs} for the rule. Every
 * other card is listed with a reason and left unchanged, and the exit code
 * stays 0: `bbx validate` keeps warning on those cards
 * (`core/card-lint.ts`), which is how an agent finds the tail to finish.
 *
 * Idempotent: a repaired card holds an `attach/` ref and is skipped.
 * Registered in src/core/migrations.ts. Also:
 *   pnpm exec tsx scripts/migrate/filename-attach-scope.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/filename-attach-scope.ts <boxRoot> --apply
 */

import { statSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { parseFrontmatterObject } from "../../src/cards/frontmatter.js";
import { listBoxCardFiles, listBoxMarkdownFiles, listBoxViewFiles } from "../../src/core/list-cards.js";
import {
  collectCardRefTokens,
  rewriteCardRefTokens,
  rewriteReferrerRefs,
  rewriteViewRefs,
  type Remap,
} from "../../src/core/rewrite-card-refs.js";
import { errorMessage } from "../../src/lib/error-guards.js";
import { isRecord } from "../../src/lib/is-record.js";
import { attachDirFor, isAttachRef, resolveAttachRef } from "../../src/shared/attach-path.js";
import { isUrlRef, resolveRefPath } from "../../src/shared/ref-path.js";

/** The card types whose schema says `filename.ref` names a file in the attach scope. */
const MEDIA_CARD = /\.(image|audio|file|pdf)\.card$/;

/** A media card and its `filename.ref`, both box-relative with `/` separators. */
export interface MediaCard {
  cardRel: string;
  ref: string;
}

export type Decision =
  | { kind: "repair"; cardRel: string; ref: string; fromRel: string; toRel: string; newRef: string; staleRel?: string }
  | { kind: "ambiguous"; cardRel: string; ref: string; reason: string };

/** `staleRel` is where a dangling ref pointed (route b); other refs to it follow the repair too. */
type Target = { fileRel: string; staleRel?: string } | { reason: string };

/**
 * Find the file a non-`attach/` ref means, if that is certain. Two routes:
 *  a. the ref resolves to a file in the card's own directory;
 *  b. the ref is dangling, and a file with its basename is in the card's
 *     own directory — the card's directory moved and the ref kept the old one.
 */
function locate(card: MediaCard, isFile: (rel: string) => boolean): Target {
  const cardDir = path.posix.dirname(card.cardRel);
  if (isUrlRef(card.ref)) return { reason: "external-url" };
  const resolved = resolveRefPath({ fromPath: card.cardRel, ref: card.ref, kind: "card" });
  if (resolved === null) return { reason: "escapes-box" };
  if (isFile(resolved)) {
    return path.posix.dirname(resolved) === cardDir ? { fileRel: resolved } : { reason: "outside-card-dir" };
  }
  const sibling = path.posix.join(cardDir, path.posix.basename(resolved));
  return isFile(sibling) ? { fileRel: sibling, staleRel: resolved } : { reason: "not-found" };
}

/**
 * Decide, for every media card, whether its file can be moved into its attach
 * scope. A card is repaired only when all hold:
 *  1. `filename.ref` does not start with `attach/` (else it is already done)
 *     and is not a URL;
 *  2. the file is located by route a or b in {@link locate};
 *  3. the file is not itself a card;
 *  4. no other media card's `filename.ref` means the same file.
 * Rule 5 — the destination is free or holds the same bytes — needs the file
 * contents, so the apply step checks it.
 *
 * `isFile` answers for a box-relative path; the doctest passes a `Set`.
 */
export function classifyFilenameRefs(cards: readonly MediaCard[], isFile: (rel: string) => boolean): Decision[] {
  const targets = new Map<string, Target>();
  const claimants = new Map<string, string[]>();
  for (const card of cards) {
    const target: Target = isAttachRef(card.ref)
      ? { fileRel: resolveAttachRef(card.cardRel, card.ref) ?? "" }
      : locate(card, isFile);
    targets.set(card.cardRel, target);
    if ("fileRel" in target) claimants.set(target.fileRel, [...(claimants.get(target.fileRel) ?? []), card.cardRel]);
  }

  const decisions: Decision[] = [];
  for (const card of cards) {
    if (isAttachRef(card.ref)) continue;
    const target = targets.get(card.cardRel);
    if (target === undefined) continue;
    const base = { cardRel: card.cardRel, ref: card.ref };
    if ("reason" in target) {
      decisions.push({ kind: "ambiguous", ...base, reason: target.reason });
      continue;
    }
    if (target.fileRel.endsWith(".card")) {
      decisions.push({ kind: "ambiguous", ...base, reason: "target-is-card" });
      continue;
    }
    const others = (claimants.get(target.fileRel) ?? []).filter((c) => c !== card.cardRel);
    if (others.length > 0) {
      decisions.push({ kind: "ambiguous", ...base, reason: `shared-with ${others.join(", ")}` });
      continue;
    }
    const name = path.posix.basename(target.fileRel);
    decisions.push({
      kind: "repair",
      ...base,
      fromRel: target.fileRel,
      toRel: `${attachDirFor(card.cardRel)}/${name}`,
      newRef: `attach/${name}`,
      ...(target.staleRel === undefined ? {} : { staleRel: target.staleRel }),
    });
  }
  return decisions;
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function isRegularFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch (_e) {
    // A missing or unreadable path is simply "not a file" for the rule.
    return false;
  }
}

interface Report {
  repaired: Decision[];
  ambiguous: Decision[];
  noFrontmatter: string[];
  refsRewritten: number;
  failed: Array<{ file: string; error: string }>;
}

async function readMediaCards(boxRoot: string, report: Report): Promise<MediaCard[]> {
  const cards: MediaCard[] = [];
  for (const abs of await listBoxCardFiles(boxRoot)) {
    if (!MEDIA_CARD.test(abs)) continue;
    const cardRel = toPosix(path.relative(boxRoot, abs));
    let fields: Record<string, unknown> | null;
    try {
      fields = parseFrontmatterObject(await readFile(abs, "utf8"));
    } catch (e) {
      report.failed.push({ file: cardRel, error: errorMessage(e) });
      continue;
    }
    if (fields === null) {
      report.noFrontmatter.push(cardRel);
      continue;
    }
    const filename = fields["filename"];
    if (!isRecord(filename) || typeof filename["ref"] !== "string") continue;
    cards.push({ cardRel, ref: filename["ref"] });
  }
  return cards;
}

/** Move one file into its card's attach scope; rule 5 decides a taken destination. */
async function moveIntoScope(boxRoot: string, decision: Extract<Decision, { kind: "repair" }>): Promise<"moved" | "differs"> {
  const fromAbs = path.join(boxRoot, decision.fromRel);
  const toAbs = path.join(boxRoot, decision.toRel);
  if (isRegularFile(toAbs)) {
    const [a, b] = await Promise.all([readFile(fromAbs), readFile(toAbs)]);
    if (!a.equals(b)) return "differs";
    await unlink(fromAbs);
    return "moved";
  }
  await mkdir(path.dirname(toAbs), { recursive: true });
  await rename(fromAbs, toAbs);
  return "moved";
}

/**
 * Rewrite refs after the moves. A repaired card's own refs to its file become
 * `attach/<file>` — the resolving ones, plus its `filename.ref` token when it
 * was dangling (route b). Every other ref to a moved file, in any card, `.md`
 * or view, follows the move in its own style; so does a ref to the stale path
 * a route-b card pointed at.
 */
async function rewriteRefs({ boxRoot, repaired, report }: {
  boxRoot: string;
  repaired: ReadonlyArray<Extract<Decision, { kind: "repair" }>>;
  report: Report;
}): Promise<void> {
  const byFromAbs = new Map(repaired.flatMap((d) => {
    const toAbs = path.join(boxRoot, d.toRel);
    const stale: Array<[string, string]> = d.staleRel === undefined ? [] : [[path.join(boxRoot, d.staleRel), toAbs]];
    return [[path.join(boxRoot, d.fromRel), toAbs], ...stale];
  }));
  const remap: Remap = (abs) => byFromAbs.get(abs) ?? null;
  const byCard = new Map(repaired.map((d) => [d.cardRel, d]));
  const referrers = [
    ...(await listBoxCardFiles(boxRoot)),
    ...(await listBoxMarkdownFiles(boxRoot)),
    ...(await listBoxViewFiles(boxRoot)),
  ];
  for (const abs of referrers) {
    const rel = toPosix(path.relative(boxRoot, abs));
    try {
      const original = await readFile(abs, "utf8");
      let text = original;
      let count = 0;
      const own = byCard.get(rel);
      if (own !== undefined) {
        const replacements = new Map<string, string>();
        for (const token of collectCardRefTokens({ text, skipFencedCode: false })) {
          const resolved = resolveRefPath({ fromPath: rel, ref: token, kind: "card" });
          if (token === own.ref || resolved === own.fromRel || (resolved !== null && resolved === own.staleRel)) {
            replacements.set(token, own.newRef);
          }
        }
        const result = rewriteCardRefTokens({ text, replacements, skipFencedCode: false });
        text = result.text;
        count += result.count;
      }
      const result = abs.endsWith(".tsx")
        ? rewriteViewRefs({ boxRoot, viewAbsPath: abs, text, remap })
        : rewriteReferrerRefs({ boxRoot, cardAbsPath: abs, text, remap });
      text = result.text;
      count += result.count;
      if (text === original) continue;
      await writeFile(abs, text);
      report.refsRewritten += count;
      console.log(`  Updated ${String(count)} ref(s) in ${rel}`);
    } catch (e) {
      report.failed.push({ file: rel, error: errorMessage(e) });
    }
  }
}

export async function migrateBox(boxRoot: string, apply: boolean): Promise<Report> {
  const report: Report = { repaired: [], ambiguous: [], noFrontmatter: [], refsRewritten: 0, failed: [] };
  const cards = await readMediaCards(boxRoot, report);
  const decisions = classifyFilenameRefs(cards, (rel) => isRegularFile(path.join(boxRoot, rel)));
  report.ambiguous = decisions.filter((d) => d.kind === "ambiguous");
  const planned = decisions.filter((d): d is Extract<Decision, { kind: "repair" }> => d.kind === "repair");
  if (!apply) {
    report.repaired = planned;
    return report;
  }
  const moved: Array<Extract<Decision, { kind: "repair" }>> = [];
  for (const decision of planned) {
    try {
      if ((await moveIntoScope(boxRoot, decision)) === "differs") {
        report.ambiguous.push({ kind: "ambiguous", cardRel: decision.cardRel, ref: decision.ref, reason: "destination-differs" });
      } else {
        moved.push(decision);
      }
    } catch (e) {
      report.failed.push({ file: decision.cardRel, error: errorMessage(e) });
    }
  }
  report.repaired = moved;
  if (moved.length > 0) await rewriteRefs({ boxRoot, repaired: moved, report });
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.find((a) => !a.startsWith("--"));
  if (positional === undefined) {
    console.error("Usage: filename-attach-scope <boxRoot> [--apply]");
    process.exit(1);
  }
  const report = await migrateBox(path.resolve(positional), apply);

  console.log(
    `${apply ? "Moved" : "Would move"} ${String(report.repaired.length)} media file(s) into their card's attach scope; ` +
      `${String(report.refsRewritten)} ref(s) rewritten; ${String(report.ambiguous.length)} card(s) left for review; ` +
      `${String(report.failed.length)} failed.`,
  );
  if (!apply) for (const d of report.repaired) if (d.kind === "repair") console.log(`  ${d.fromRel} -> ${d.toRel}`);
  if (report.ambiguous.length > 0) {
    console.log("\nLeft unchanged (bbx validate warns on each; fix by hand or with an agent):");
    for (const d of report.ambiguous) if (d.kind === "ambiguous") console.log(`  ${d.cardRel}: ${d.reason} (filename.ref: ${d.ref})`);
  }
  if (report.noFrontmatter.length > 0) {
    console.log(`\n${String(report.noFrontmatter.length)} media card(s) without frontmatter skipped:`);
    for (const f of report.noFrontmatter) console.log(`  ${f}`);
  }
  for (const f of report.failed) console.log(`  FAIL ${f.file}: ${f.error}`);
  if (report.failed.length > 0) process.exit(2);
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
