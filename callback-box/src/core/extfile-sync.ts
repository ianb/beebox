/**
 * `cb extfile sync` core: re-stamp extfile cards' `version`/`size`/`mtime` from
 * their live external files.
 *
 * The metadata is the drift signal, so it is refreshed only by this explicit
 * command (never silently). To avoid churn, a card is rewritten **only when the
 * content hash changed** — a file whose bytes are unchanged but whose `mtime`
 * was bumped produces no card diff. The three fields move together so the card's
 * git history reads as a version-log of the (untracked) file.
 */

import { readFile, writeFile } from "node:fs/promises";
import { renderFrontmatterBlock, splitCardContent } from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { resolveExternalRef, buildExternalStamp, ExternalRefError } from "./external/ref.js";
import { rootsForBox } from "./external/roots.js";
import { errorMessage } from "../lib/error-guards.js";

export type ExtfileSyncStatus = "stamped" | "unchanged" | "unresolved";

export interface ExtfileSyncResult {
  /** Absolute path of the extfile card. */
  path: string;
  status: ExtfileSyncStatus;
  /** For `unresolved`: why (no href, outside roots, missing file, …). */
  detail?: string;
}

/** The `sha256:<hex>` value from a version-markers string, or null. */
function sha256Of(markers: string): string | null {
  for (const marker of markers.split(/\s+/)) {
    if (marker.startsWith("sha256:")) return marker.slice("sha256:".length);
  }
  return null;
}

async function syncOne(input: { path: string; roots: string[] }): Promise<ExtfileSyncResult> {
  const { path, roots } = input;
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (e) {
    return { path, status: "unresolved", detail: `cannot read card: ${errorMessage(e)}` };
  }
  const split = splitCardContent(content);
  const fm = (parseYaml(split.frontmatterText) ?? {}) as Record<string, unknown>;
  const href = fm["href"];
  if (typeof href !== "string" || href === "") {
    return { path, status: "unresolved", detail: "card has no href" };
  }

  let real: string;
  try {
    real = await resolveExternalRef(href, { roots });
  } catch (e) {
    return { path, status: "unresolved", detail: e instanceof ExternalRefError ? e.message : errorMessage(e) };
  }

  const stamp = await buildExternalStamp(real);
  const liveHash = sha256Of(stamp.version);
  const storedHash = typeof fm["version"] === "string" ? sha256Of(fm["version"]) : null;
  // Unchanged content → no rewrite, even if mtime drifted (churn control).
  if (storedHash !== null && storedHash === liveHash) {
    return { path, status: "unchanged" };
  }

  fm["version"] = stamp.version;
  fm["size"] = stamp.size;
  fm["mtime"] = stamp.mtime;
  await writeFile(path, renderFrontmatterBlock(fm, split.body));
  return { path, status: "stamped" };
}

/**
 * Re-stamp each named extfile card. Resolves every href against the box's
 * allowlisted roots; a card whose href can't be resolved is reported (status
 * `unresolved`), never thrown, so one bad pointer doesn't abort the batch.
 */
export async function syncExtfile(input: { boxRoot: string; paths: string[] }): Promise<ExtfileSyncResult[]> {
  const roots = await rootsForBox(input.boxRoot);
  const results: ExtfileSyncResult[] = [];
  for (const path of input.paths) {
    results.push(await syncOne({ path, roots }));
  }
  return results;
}
