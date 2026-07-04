/**
 * Compile the triage-instructions doc from landmarks with a `triage`
 * destination role (a `destinations` entry whose `for` includes
 * `triage`). The doc is what the triage subagent reads to decide where
 * to route each staged item.
 *
 * See `docs/triage-design.md` §3 and §Triage (stage 2).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseLandmarkFields, type LandmarkFields } from "../schemas/landmark.js";
import { findDestination } from "./landmark/destination.js";

/**
 * One triage category, derived from a landmark with a `triage`
 * destination.
 */
export interface TriageCategory {
  /**
   * Stable identifier used as the per-category holding-spot directory
   * name (`inbox/triaged/<name>/`). Derived from the last segment of
   * the landmark's directory; safe-character only. The root landmark
   * (boxes' top-level `Box.landmark.card`) uses the literal `root`.
   */
  name: string;
  /** Box-relative directory containing the landmark. */
  dir: string;
  /** `rules` text, trimmed; empty string if none. */
  rules: string;
  /**
   * The destination's handler procedure ref, or null if none. The triage
   * stage only needs to know the destination — the handle stage runs the
   * procedure later.
   */
  procedureRef: string | null;
}

export interface CompiledTriageInstructions {
  /** Markdown doc passed to the triage subagent as system prompt. */
  doc: string;
  /** Structured list of categories, keyed (and routable) by name. */
  categories: TriageCategory[];
}

const SAFE_NAME_RE = /^[\w.-]+$/;

function deriveCategoryName(dir: string): string {
  if (dir === "" || dir === ".") return "root";
  const last = path.basename(dir);
  if (!SAFE_NAME_RE.test(last)) {
    return last.replace(/\s+/g, "_").replace(/[^\w.-]/g, "") || "root";
  }
  return last;
}

async function loadLandmarkFields(absPath: string): Promise<LandmarkFields | null> {
  let content: string;
  try {
    content = await fs.readFile(absPath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    console.warn(`triage-instructions: failed to read ${absPath}: ${err.message}`);
    return null;
  }
  return parseLandmarkFields(content);
}

/**
 * Find every landmark with a `triage` destination role and build a
 * structured + textual representation suitable for the triage agent.
 */
export async function compileTriageInstructions(
  boxRoot: string,
): Promise<CompiledTriageInstructions> {
  const matches = await glob("**/*.landmark.card", {
    cwd: boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
  });

  const categories: TriageCategory[] = [];
  for (const relPath of matches) {
    const absPath = path.join(boxRoot, relPath);
    const fields = await loadLandmarkFields(absPath);
    if (fields === null) continue;

    const triageDest = findDestination(fields.destinations, "triage");
    if (triageDest === null) continue;

    const dir = path.dirname(relPath);
    const normalizedDir = dir === "." ? "" : dir;
    categories.push({
      name: deriveCategoryName(normalizedDir),
      dir: normalizedDir,
      rules: triageDest.rules?.trim() ?? "",
      procedureRef: triageDest.procedure?.ref ?? null,
    });
  }

  // Stable ordering: root first, then alphabetic by dir.
  categories.sort((a, b) => {
    if (a.dir === "" && b.dir !== "") return -1;
    if (b.dir === "" && a.dir !== "") return 1;
    return a.dir.localeCompare(b.dir);
  });

  // Detect name collisions: two landmarks both deriving to the same
  // category name. Disambiguate by appending the parent directory.
  const seen = new Map<string, number>();
  for (const cat of categories) {
    const count = seen.get(cat.name) ?? 0;
    seen.set(cat.name, count + 1);
    if (count > 0) {
      const parent = path.dirname(cat.dir);
      const parentName = parent === "" || parent === "." ? "root" : path.basename(parent);
      cat.name = `${parentName}-${cat.name}`;
    }
  }

  return { doc: renderDoc(categories), categories };
}

function renderDoc(categories: TriageCategory[]): string {
  const lines: string[] = [];
  lines.push("# Triage Categories");
  lines.push("");
  lines.push(
    "Each section is one category. Route each staged item into the category whose rules best match.",
  );
  lines.push("");
  if (categories.length === 0) {
    lines.push("(No categories defined. Every item should land at confidence `guess`.)");
    return lines.join("\n");
  }
  for (const cat of categories) {
    lines.push(`## \`${cat.name}\``);
    lines.push("");
    lines.push(`Directory: \`${cat.dir || "(box root)"}\``);
    lines.push("");
    if (cat.rules) {
      lines.push("Rules:");
      lines.push("");
      lines.push(cat.rules);
    } else {
      lines.push("_No rules defined yet — be cautious about routing here._");
    }
    lines.push("");
  }
  return lines.join("\n");
}
