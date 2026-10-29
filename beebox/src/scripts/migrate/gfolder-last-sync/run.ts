#!/usr/bin/env tsx
/**
 * `gfolder-last-sync-2026-10` runner: move each folder mount's `last-sync`
 * from its `.gfolder.card` into the Drive state file (`plan.ts` holds the
 * per-card decision).
 *
 * 1. Plan every `.gfolder.card` in the box, trash included (a restored card
 *    would otherwise bring the field back). Without `--apply` the runner stops
 *    after printing the plan.
 * 2. Seed the state: for each Drive ID, the latest card time, unless the state
 *    already holds a later one (a pass that ran after the deploy). State goes
 *    first, so an interrupted run leaves cards a rerun still finds.
 * 3. Write each card without the key.
 * 4. Verify: a fresh plan must find nothing left to strip.
 *
 * A card that cannot be planned (unparseable YAML that names `last-sync`, or
 * a value that is not a plain string) is a leftover: the runner prints it
 * last and exits 2. A rerun on a migrated box reports "already current".
 *
 * Usage:
 *   pnpm exec tsx src/scripts/migrate/gfolder-last-sync/run.ts <boxRoot>           # plan only
 *   pnpm exec tsx src/scripts/migrate/gfolder-last-sync/run.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { glob } from "glob";
import { DRIVE_CARD_IGNORE, GFOLDER_CARD_TYPE } from "../../../connectors/google-drive/tracking.js";
import { DEFAULT_DRIVE_STATE, normalizeDriveState, type DriveTransientState } from "../../../connectors/google-drive/state.js";
import { updateTransientState } from "../../../transient-state.js";
import { planGfolderLastSync } from "./plan.js";

export type RunMode = "plan" | "apply";

interface Strip {
  relPath: string;
  text: string;
  driveId: string;
  lastSync: string;
}

async function planBox(boxRoot: string): Promise<{ strips: Strip[]; leftovers: string[] }> {
  const relPaths = await glob(`**/*.${GFOLDER_CARD_TYPE}.card`, {
    cwd: boxRoot,
    nodir: true,
    ignore: DRIVE_CARD_IGNORE,
  });
  const strips: Strip[] = [];
  const leftovers: string[] = [];
  for (const relPath of relPaths.toSorted()) {
    const plan = planGfolderLastSync(await fs.readFile(path.join(boxRoot, relPath), "utf-8"));
    if (plan.kind === "strip") strips.push({ relPath, text: plan.text, driveId: plan.driveId, lastSync: plan.lastSync });
    if (plan.kind === "leftover") leftovers.push(`leftover: ${relPath}: ${plan.reason}`);
  }
  return { strips, leftovers };
}

/** The state with each strip's time, keeping whichever time is later. */
function seeded(state: DriveTransientState, strips: Strip[]): DriveTransientState {
  const folders = { ...state.folders };
  for (const strip of strips) {
    const held = folders[strip.driveId]?.lastSync;
    // Box times are all `toISOString()` output, so they order as strings.
    if (held === undefined || held < strip.lastSync) folders[strip.driveId] = { lastSync: strip.lastSync };
  }
  return { ...state, folders };
}

/** One run over one box. Returns the exit code and the lines it printed. */
export async function runGfolderLastSync({ boxRoot, mode }: { boxRoot: string; mode: RunMode }): Promise<{ code: number; lines: string[] }> {
  const { strips, leftovers } = await planBox(boxRoot);
  const leftoverCode = leftovers.length > 0 ? 2 : 0;
  if (strips.length === 0) {
    return { code: leftoverCode, lines: ["gfolder-last-sync: already current.", ...leftovers] };
  }
  const names = strips.map((strip) => strip.relPath);
  if (mode === "plan") {
    return { code: 0, lines: [...names.map((name) => `would strip last-sync from ${name} (dry run; pass --apply)`), ...leftovers] };
  }
  await updateTransientState({
    boxRoot,
    connectorName: "google-drive",
    defaultValue: DEFAULT_DRIVE_STATE,
    update: (fresh: Parameters<typeof normalizeDriveState>[0]) => seeded(normalizeDriveState(fresh), strips),
  });
  for (const strip of strips) await fs.writeFile(path.join(boxRoot, strip.relPath), strip.text);
  if ((await planBox(boxRoot)).strips.length > 0) {
    return { code: 1, lines: ["gfolder-last-sync: verify failed: a card still holds last-sync."] };
  }
  return { code: leftoverCode, lines: [...names.map((name) => `gfolder-last-sync: moved last-sync out of ${name}.`), ...leftovers] };
}

// CLI entry — only when run directly, not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: gfolder-last-sync/run.ts <boxRoot> [--apply]\n\nMove last-sync off .gfolder.card files into the Drive state.");
    process.exit(1);
  }
  const mode: RunMode = args.includes("--apply") ? "apply" : "plan";
  const { code, lines } = await runGfolderLastSync({ boxRoot: path.resolve(boxRoot), mode });
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
