#!/usr/bin/env tsx
/**
 * `body-tags-2026-10` runner: rewrite the retired `image`, `silence`,
 * `purpose`, and `correction` Markdoc tags in every card (`plan.ts` holds the
 * decision). Three phases per box:
 *
 * 1. Plan: read every `*.card` under the box root, call `planBodyTagRewrites`.
 *    Any failure prints each path (and line) and exits 1 with nothing written.
 *    Exit 1 is a hard failure: `bbx engine migrate` records no manifest entry
 *    and later migrations wait (`core/migration-sweep.ts`). The shared harness
 *    is not used because its per-file failure is the soft exit 2, which
 *    records the migration (`core/migration-run.ts`). Without `--apply` the
 *    runner stops here and prints the plan.
 * 2. Apply: write each file, one at a time; a rerun finishes a box left
 *    half-converted because converted cards are skipped. The root briefing,
 *    when it is a stock seed (a `briefing-seed` hash, current or superseded),
 *    becomes `createBriefingTemplate()` verbatim and its template ledger entry
 *    is updated through `recordAutomatedTemplateRewrite`.
 * 3. Verify: re-parse every card; one still holding any of the four tag nodes
 *    exits 1. `--verify` alone runs only this phase, for the post-rollout
 *    check (`bbx validate` only warns on a leftover tag).
 *
 * Parked template mirrors under `_config/_template-updates/` are not live cards
 * and are skipped; the installer rewrites them. `.git` and `node_modules` too.
 *
 * Usage:
 *   pnpm exec tsx src/scripts/migrate/body-tags/run.ts <boxRoot>           # plan only
 *   pnpm exec tsx src/scripts/migrate/body-tags/run.ts <boxRoot> --apply
 *   pnpm exec tsx src/scripts/migrate/body-tags/run.ts <boxRoot> --verify
 */

import type { Node } from "@markdoc/markdoc";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { splitCardContent } from "../../../cards/frontmatter.js";
import { readVersions, TEMPLATE_UPDATES_DIR } from "../../../core/install-template-file.js";
import { recordAutomatedTemplateRewrite } from "../../../core/template-update.js";
import { TEMPLATE_STOCK_HASHES } from "../../../core/template-stock-hashes.js";
import { createBriefingTemplate } from "../../../schemas/briefing.js";
import { parseMarkdown } from "../../../shared/markdoc-config/parse/core.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { createHash } from "node:crypto";
import { planBodyTagRewrites, ROOT_BRIEFING_PATH, RETIRED_TAGS, RETIRED_TAG_PATTERN, type CardInput } from "./plan.js";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** Box-relative paths of every live `*.card`, sorted. */
async function findCards(boxRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(path.join(boxRoot, rel), { withFileTypes: true });
    } catch (e) {
      if (errnoCode(e) === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && child !== TEMPLATE_UPDATES_DIR) await walk(child);
      } else if (entry.isFile() && entry.name.endsWith(".card")) out.push(child);
    }
  }
  await walk("");
  return out.toSorted();
}

async function readCards(boxRoot: string): Promise<CardInput[]> {
  const cards: CardInput[] = [];
  for (const rel of await findCards(boxRoot)) cards.push({ path: rel, text: await fs.readFile(path.join(boxRoot, rel), "utf8") });
  return cards;
}

/** True when the Markdoc parse holds a node for one of the four tags, or an error node (an orphaned closing tag parses as one). */
function hasRetiredTag(node: Node): boolean {
  if (node.type === "error") return true;
  if (node.type === "tag" && node.tag !== undefined && RETIRED_TAGS.has(node.tag)) return true;
  return node.children.some(hasRetiredTag);
}

/** Cards that still carry one of the four tags. */
async function verify(boxRoot: string): Promise<string[]> {
  const left: string[] = [];
  for (const card of await readCards(boxRoot)) {
    if (!RETIRED_TAG_PATTERN.test(card.text)) continue;
    if (hasRetiredTag(parseMarkdown(splitCardContent(card.text).body))) left.push(card.path);
  }
  return left;
}

export type RunMode = "plan" | "apply" | "verify";

/** One run over one box. Returns the exit code and the lines it printed. */
export async function runBodyTags({ boxRoot, mode }: { boxRoot: string; mode: RunMode }): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  if (mode !== "verify") {
    const stock = TEMPLATE_STOCK_HASHES["briefing-seed"];
    const seed = createBriefingTemplate();
    const stockSeedHashes = new Set([stock.current, ...stock.superseded]);
    const cards = await readCards(boxRoot);
    const plan = planBodyTagRewrites(cards, { seed, stockSeedHashes });
    if (plan.failures.length > 0) {
      for (const failure of plan.failures) lines.push(`failed: ${failure.path}${failure.line === undefined ? "" : `:${String(failure.line)}`}: ${failure.reason}`);
      lines.push(`body-tags: ${String(plan.failures.length)} failure(s); nothing written.`);
      return { code: 1, lines };
    }
    for (const file of plan.writes) lines.push(`write ${file.path}${mode === "plan" ? " (dry run; pass --apply)" : ""}`);
    lines.push(plan.writes.length === 0 ? `body-tags: already migrated; ${String(plan.skipped)} card(s) skipped.` : `body-tags: rewrite ${String(plan.writes.length)}, skipped ${String(plan.skipped)}.`);
    if (mode === "plan") return { code: 0, lines };
    const versions = await readVersions(boxRoot);
    for (const file of plan.writes) {
      await fs.writeFile(path.join(boxRoot, file.path), file.after, "utf8");
      if (versions[file.path]?.sha256 !== undefined) {
        await recordAutomatedTemplateRewrite({ boxRoot, relPath: file.path, before: file.before, after: file.after });
      }
    }
    // An earlier run may have written the seed and stopped before the ledger
    // update; the ledger's own `stock` text is the pre-image it needs.
    const rootCard = cards.find((card) => card.path === ROOT_BRIEFING_PATH);
    const recorded = versions[ROOT_BRIEFING_PATH];
    if (rootCard?.text === seed && recorded?.stock !== undefined && recorded.sha256 !== undefined && recorded.sha256 !== sha256(seed) && stockSeedHashes.has(recorded.sha256)) {
      await recordAutomatedTemplateRewrite({ boxRoot, relPath: ROOT_BRIEFING_PATH, before: recorded.stock, after: seed });
    }
  }
  const left = await verify(boxRoot);
  if (left.length > 0) {
    for (const rel of left) lines.push(`still carries a retired tag: ${rel}`);
    lines.push(`body-tags: verify failed; ${String(left.length)} card(s) still carry a retired tag.`);
    return { code: 1, lines };
  }
  if (mode === "verify") lines.push("body-tags: verify clean.");
  return { code: 0, lines };
}

// CLI entry — only when run directly, not when imported by a doctest.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: body-tags/run.ts <boxRoot> [--apply | --verify]\n\nRewrite the retired image, silence, purpose, and correction tags.");
    process.exit(1);
  }
  const mode: RunMode = args.includes("--verify") ? "verify" : args.includes("--apply") ? "apply" : "plan";
  const { code, lines } = await runBodyTags({ boxRoot: path.resolve(boxRoot), mode });
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
