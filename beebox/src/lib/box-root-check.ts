/**
 * The closed-vocabulary root check (Track C, `docs/plans/one-root-box-layout.md`):
 * every box-root entry must be in `BOX_ROOT_VOCABULARY` — the npm namespace,
 * spec'd agent-identity files, or one of the five underscore areas. Anything
 * else is a stray, and this is the check that turns a recreated two-root
 * shape (the test1 incident this plan's evidence section documents) from two
 * silent months into one loud `bbx validate`.
 *
 * Wired into `bbx validate` (errors) and `bbx status` (a warnings section) —
 * see `src/cli/commands/validate.ts` / `status.ts` — and into
 * `bbx validate --hook` for an edit at the box root or under the npm
 * namespace (`src/cli/commands/validate-hook.ts`).
 */

import * as fs from "node:fs/promises";
import { BOX_ROOT_VOCABULARY } from "./box-root-vocabulary.js";
import { errnoCode } from "./error-guards.js";

/** OS/editor junk that is never a real stray — ignored outright, not reported. */
const IGNORED_JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".localized"]);

const VOCABULARY_NAMES: ReadonlySet<string> = new Set(BOX_ROOT_VOCABULARY.map((entry): string => entry.name));

export interface BoxRootStray {
  /** The offending root entry's name. */
  name: string;
  /** `"ad-hoc-underscore"` — an unlisted `_`-prefixed name; `"unlisted"` — anything else. */
  kind: "ad-hoc-underscore" | "unlisted";
  /** Human-facing explanation, ready to print as-is. */
  message: string;
}

/**
 * Readdir a box root and report every entry outside the closed vocabulary.
 * Pure I/O, no validation-severity opinion — callers (`bbx validate` errors,
 * `bbx status` warnings) decide how to surface what comes back.
 */
export async function checkBoxRoot(boxRoot: string): Promise<BoxRootStray[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(boxRoot);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }

  const strays: BoxRootStray[] = [];
  for (const name of entries.toSorted()) {
    if (IGNORED_JUNK.has(name)) continue;
    if (VOCABULARY_NAMES.has(name)) continue;

    if (name.startsWith("_")) {
      strays.push({
        name,
        kind: "ad-hoc-underscore",
        message: `${name}: ad hoc underscore directories are reserved — the underscore areas are exactly _content, _config, _bookkeeping, _publish, _tmp; rename or remove this one`,
      });
      continue;
    }

    // "content" specifically is the recreated-two-root shape this check
    // exists to catch (the test1 incident, `docs/plans/one-root-box-layout.md`
    // "The evidence") — called out by name rather than folded into the
    // generic message, so it reads as the known failure mode, not a novel one.
    const historical = name === "content" ? " (this is the pre-migration operational-root name — a v2 leftover, not a place to write to)" : "";
    strays.push({
      name,
      kind: "unlisted",
      message: `${name}: the box root is a closed vocabulary — user content goes under /_content/${historical}`,
    });
  }
  return strays;
}
