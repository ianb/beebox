/**
 * Compile the triage-instructions doc from landmarks with a
 * `<triage-destination>` role. The doc is what the triage subagent
 * reads to decide where to route each staged item.
 *
 * See `docs/triage-design.md` §3 and §Triage (stage 2).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseXml, type ElementNode } from "cardworks";

/**
 * One triage category, derived from a landmark with a
 * `<triage-destination>` child.
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
  /** `<rules>` text, trimmed; empty string if no rules element. */
  rules: string;
  /**
   * Inline handler procedure (raw XML) or a `ref` attribute. The
   * triage stage only needs to know the destination — the handle
   * stage runs the procedure later.
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

function findChild(element: ElementNode, tagName: string): ElementNode | null {
  for (const child of element.children) {
    if (child.tagName === tagName) return child;
  }
  return null;
}

function extractRules(triageDest: ElementNode): string {
  const rules = findChild(triageDest, "rules");
  if (!rules || typeof rules.text !== "string") return "";
  return rules.text.trim();
}

function extractProcedureRef(triageDest: ElementNode): string | null {
  const proc = findChild(triageDest, "procedure");
  if (!proc) return null;
  const ref = proc.attrs["ref"];
  if (typeof ref === "string" && ref !== "") return ref;
  // Inline procedure: store the serialized XML so the handler can find
  // it. We don't try to re-serialize here — the handle stage re-reads
  // the landmark to access the inline form.
  return "inline";
}

async function loadLandmark(absPath: string): Promise<ElementNode | null> {
  try {
    const content = await fs.readFile(absPath, "utf-8");
    return await parseXml(content, absPath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    console.warn(`triage-instructions: failed to parse ${absPath}: ${err.message}`);
    return null;
  }
}

/**
 * Find every landmark with a `<triage-destination>` role and build a
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
    const element = await loadLandmark(absPath);
    if (!element || element.tagName !== "landmark") continue;

    const triageDest = findChild(element, "triage-destination");
    if (!triageDest) continue;

    const dir = path.dirname(relPath);
    const normalizedDir = dir === "." ? "" : dir;
    categories.push({
      name: deriveCategoryName(normalizedDir),
      dir: normalizedDir,
      rules: extractRules(triageDest),
      procedureRef: extractProcedureRef(triageDest),
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
