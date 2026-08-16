/**
 * Nav card resolution — loads the box root's `nav.card` and turns it into
 * render-ready entries. Consumed by the nav tRPC router (the app bar's
 * switch menu) and by the health check (an invalid nav card is a health
 * warning, not a broken nav — the menu keeps its builtin rows either way).
 * See docs/implemented-plans/nav-card.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../cards/index.js";
import { parseNavFields } from "../schemas/nav.js";
import { navRouteFor } from "../shared/nav-routes.js";
import { titleFromFilename } from "./file-summary.js";
import { resolveBoxRelativeRef, realpathContained } from "../lib/box-containment.js";
import { resolveRefPath } from "../shared/ref-path.js";
import { errnoCode, errorMessage } from "../lib/error-guards.js";
import { isRecord } from "./card-io.js";

export const NAV_CARD_PATH = "nav.card";

export interface NavEntryResolved {
  kind: "href" | "ref";
  /** href: the route path. ref: the box-relative card path. */
  target: string;
  label: string;
  /** ref entries only: whether the target file exists. */
  exists?: boolean;
}

export type NavResolution =
  /** No nav.card — the menu shows only its builtin rows; not a problem. */
  | { status: "absent" }
  /** nav.card exists but doesn't validate — no section + health warning. */
  | { status: "invalid"; error: string }
  /**
   * Valid card. `problems` lists non-fatal issues (dangling refs) for the
   * health check; the entries still render.
   */
  | { status: "ok"; entries: NavEntryResolved[]; problems: string[] };

/**
 * Read a card's frontmatter `title` for a ref entry's default label,
 * falling back to the filename-derived title. Any read/parse failure just
 * means "no title" — existence is reported separately.
 */
async function readCardTitle(absPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(absPath, "utf-8");
    const split = splitCardContent(content);
    if (!split.hasFrontmatter) return null;
    const fm: unknown = parseYaml(split.frontmatterText);
    if (isRecord(fm)) {
      const title = fm["title"];
      if (typeof title === "string" && title.trim() !== "") return title.trim();
    }
    return null;
  } catch (_e) {
    // Unreadable target — the exists check reports it; no title to offer.
    return null;
  }
}

export async function resolveNav(boxRoot: string): Promise<NavResolution> {
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, NAV_CARD_PATH), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return { status: "absent" };
    return { status: "invalid", error: `could not read ${NAV_CARD_PATH}: ${errorMessage(e)}` };
  }

  const parsed = parseNavFields(content);
  if (parsed.fields === null) return { status: "invalid", error: parsed.error };

  const entries: NavEntryResolved[] = [];
  const problems: string[] = [];

  for (const entry of parsed.fields.entries) {
    if ("href" in entry) {
      const route = navRouteFor(entry.href);
      entries.push({
        kind: "href",
        target: entry.href,
        // The schema already validated the href, so `route` is always found;
        // the fallback only guards a route-table/schema drift.
        label: entry.label ?? route?.label ?? entry.href,
      });
      continue;
    }
    // Nav refs address the box root: `nav.card` sits at the root, so the
    // canonical leading-`/` form and the bare form name the same file. The
    // shared algebra normalizes both (`fromPath: undefined` — the root IS the
    // referring document's directory) and fails closed on a `..` escape.
    const boxPath = resolveRefPath({ fromPath: undefined, ref: entry.ref, kind: "card" });
    const contained = boxPath === null ? null : resolveBoxRelativeRef(boxRoot, boxPath);
    if (contained === null) {
      console.warn(`resolveNav: ref "${entry.ref}" escapes the box`);
      problems.push(`ref "${entry.ref}" must be box-relative (must not escape the box via ..)`);
      continue;
    }
    // `stat` follows symlinks; realpath-verify so a nav ref can't point (via an
    // in-box symlink) at a file outside the box.
    const safe = await realpathContained(boxRoot, contained);
    if (safe === null) {
      console.warn(`resolveNav: ref "${entry.ref}" resolves outside the box via symlink`);
      problems.push(`ref "${entry.ref}" must be box-relative (must not escape the box via a symlink)`);
      continue;
    }
    const absPath = path.join(boxRoot, safe);
    let exists = true;
    try {
      const stat = await fs.stat(absPath);
      exists = stat.isFile();
    } catch (_e) {
      // stat throwing means the target is missing — exactly what `exists` reports.
      exists = false;
    }
    if (!exists) problems.push(`ref "${entry.ref}" does not point at an existing file`);
    const title = exists ? await readCardTitle(absPath) : null;
    entries.push({
      kind: "ref",
      // The normalized box-relative form, not the raw ref: the shell builds
      // `/<box>/browse/<target>` from it, so a leading-`/` ref must arrive
      // resolved (both authored forms yield the same target).
      target: safe,
      label: entry.label ?? title ?? titleFromFilename(safe),
      exists,
    });
  }

  return { status: "ok", entries, problems };
}
