/**
 * Nav card resolution — loads the box root's `nav.card` and turns it into
 * render-ready entries. Consumed by the nav tRPC router (AppNav) and by
 * the health check (an invalid nav card is a health warning, not a broken
 * nav — the shell falls back to the builtin nav either way).
 * See docs/implemented-plans/nav-card.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../cards/index.js";
import { parseNavFields } from "../schemas/nav.js";
import { navRouteFor } from "../shared/nav-routes.js";
import { titleFromFilename } from "./file-summary.js";

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
  /** No nav.card — the shell shows the builtin nav; not a problem. */
  | { status: "absent" }
  /** nav.card exists but doesn't validate — builtin fallback + health warning. */
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
    if (fm !== null && typeof fm === "object" && !Array.isArray(fm)) {
      const title = (fm as Record<string, unknown>)["title"];
      if (typeof title === "string" && title.trim() !== "") return title.trim();
    }
    return null;
  } catch (_e) {
    // Unreadable target — the exists check reports it; no title to offer.
    return null;
  }
}

/** Reject refs that could escape the box (absolute or `..` segments). */
function isBoxRelative(ref: string): boolean {
  return !ref.startsWith("/") && !ref.split("/").includes("..");
}

export async function resolveNav(boxRoot: string): Promise<NavResolution> {
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, NAV_CARD_PATH), "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    return { status: "invalid", error: `could not read ${NAV_CARD_PATH}: ${(e as Error).message}` };
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
    if (!isBoxRelative(entry.ref)) {
      problems.push(`ref "${entry.ref}" must be box-relative (no leading / or .. segments)`);
      continue;
    }
    const absPath = path.join(boxRoot, entry.ref);
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
      target: entry.ref,
      label: entry.label ?? title ?? titleFromFilename(entry.ref),
      exists,
    });
  }

  return { status: "ok", entries, problems };
}
