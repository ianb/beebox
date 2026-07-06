/**
 * cb contains - Lifecycle commands for the global `contains` field.
 *
 *   cb contains list [--missing|--stale] [--json]   worklist for backfill/review
 *   cb contains update <card> --text "..."          set or confirm (re-bases staleness)
 */

import { Command } from "commander";
import path from "node:path";
import { requireBoxRoot } from "../../lib/paths.js";
import { openSearchIndex } from "../../core/search/refresh.js";
import {
  loadContainsState,
  listMissing,
  listStale,
} from "../../core/search/contains-state.js";
import {
  updateContainsField,
  ContainsUpdateError,
} from "../../core/search/contains-update.js";

/** Human output cap per group; --json is always complete. */
const LIST_CAP = 100;

interface ListOptions {
  missing?: boolean;
  stale?: boolean;
  json?: boolean;
}

async function runList(options: ListOptions): Promise<void> {
  const boxRoot = await requireBoxRoot();
  // Refresh first so the sidecar reflects the filesystem as of now.
  await openSearchIndex(boxRoot);
  const state = await loadContainsState(boxRoot);
  const wantMissing = options.missing === true || options.stale !== true;
  const wantStale = options.stale === true || options.missing !== true;
  const missing = wantMissing ? listMissing(state) : [];
  const stale = wantStale ? listStale(state) : [];

  if (options.json === true) {
    const payload: Record<string, unknown> = {};
    if (wantMissing) payload["missing"] = missing;
    if (wantStale) payload["stale"] = stale;
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printGroup("missing contains:", { paths: missing, enabled: wantMissing });
  printGroup("stale contains (content changed since written):", { paths: stale, enabled: wantStale });
}

function printGroup(label: string, { paths, enabled }: { paths: string[]; enabled: boolean }): void {
  if (!enabled) return;
  console.log(`${label} ${String(paths.length)}`);
  for (const p of paths.slice(0, LIST_CAP)) {
    console.log(`  ${p}`);
  }
  if (paths.length > LIST_CAP) {
    console.log(`  ...and ${String(paths.length - LIST_CAP)} more (use --json for the full list)`);
  }
}

async function runUpdate(card: string, options: { text: string }): Promise<void> {
  const boxRoot = await requireBoxRoot();
  const relPath = path.isAbsolute(card) ? path.relative(boxRoot, card) : card;
  try {
    const { unchanged } = await updateContainsField(boxRoot, { relPath, text: options.text });
    console.log(
      unchanged
        ? `${relPath}: contains confirmed unchanged (staleness re-based)`
        : `${relPath}: contains updated`
    );
  } catch (e) {
    if (!(e instanceof ContainsUpdateError)) throw e;
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

export const containsCommand = new Command("contains").description(
  "Inspect and maintain the contains: field across the box"
);

containsCommand
  .command("list")
  .description("Cards whose contains: is missing or stale")
  .option("--missing", "Only searchable cards with no contains: yet")
  .option("--stale", "Only cards whose content changed since contains: was written")
  .option("--json", "Full lists as JSON")
  .action(async (options: ListOptions) => {
    try {
      await runList(options);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

containsCommand
  .command("update")
  .description("Set a card's contains: (same text = confirm a stale flag)")
  .argument("<card>", "Box-relative card path")
  .requiredOption("--text <text>", "The contains sentence")
  .action(async (card: string, options: { text: string }) => {
    try {
      await runUpdate(card, options);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
