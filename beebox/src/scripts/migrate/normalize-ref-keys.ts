#!/usr/bin/env tsx

/**
 * Normalize card references onto a `ref` key.
 *
 * Every card reference must be stored under a key named exactly `ref`
 * (`<field>: { ref: <path> }`), never as a bare string under a
 * differently-named key. Two historical shapes violated that rule:
 *
 *   1. landmark cards — `destinations[].procedure-ref: <path>` (bare string)
 *      becomes `destinations[].procedure: { ref: <path> }`.
 *   2. webpage and commentary cards — a top-level `frozen: <string>` becomes
 *      `frozen: { ref: <string> }`.
 *
 * Frontmatter is parsed, mutated, and re-stringified with the `yaml` package
 * so the rewrite is robust to formatting. Idempotent: a value already nested
 * as `{ ref: … }` (or a card with neither field) is left untouched.
 *
 * Registered in src/core/migrations.ts, so `bbx migrate --apply` runs it
 * against any box that hasn't yet recorded it. Also runnable directly:
 *   pnpm exec tsx scripts/migrate/normalize-ref-keys.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/normalize-ref-keys.ts <boxRoot> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Split a card's frontmatter text from its body. Returns null if no frontmatter. */
function splitCard(raw: string): { fm: string; body: string } | null {
  const m = raw.match(/^---\r?\n([\S\s]*?)\r?\n---\r?\n?([\S\s]*)$/);
  if (m === null) return null;
  return { fm: m[1] ?? "", body: m[2] ?? "" };
}

/**
 * Rewrite one card's parsed frontmatter in place. Returns true if anything
 * changed. Dispatches on the card type, taken from the filename
 * (`Name.<type>.card`).
 */
function normalizeFields(type: string, fm: Record<string, unknown>): boolean {
  let changed = false;
  if (type === "landmark") {
    const destinations = fm["destinations"];
    if (Array.isArray(destinations)) {
      for (const dest of destinations) {
        if (!isRecord(dest)) continue;
        const procRef = dest["procedure-ref"];
        if (typeof procRef === "string") {
          delete dest["procedure-ref"];
          dest["procedure"] = { ref: procRef };
          changed = true;
        }
      }
    }
  } else if (type === "webpage" || type === "commentary") {
    const frozen = fm["frozen"];
    if (typeof frozen === "string") {
      fm["frozen"] = { ref: frozen };
      changed = true;
    }
  }
  return changed;
}

/** Card type from a `Name.<type>.card` filename, or null. */
function cardType(fileName: string): string | null {
  if (!fileName.endsWith(".card")) return null;
  const noCard = fileName.slice(0, -".card".length);
  const lastDot = noCard.lastIndexOf(".");
  return lastDot === -1 ? null : noCard.slice(lastDot + 1);
}

/** Rewrite one card file's text, or null if nothing changed. Exported for tests. */
export function rewriteCardText(fileName: string, raw: string): string | null {
  const type = cardType(fileName);
  if (type !== "landmark" && type !== "webpage" && type !== "commentary") return null;
  const split = splitCard(raw);
  if (split === null) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(split.fm);
  } catch (_e) {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!normalizeFields(type, parsed)) return null;
  const yamlText = stringifyYaml(parsed);
  const tail = split.body === "" ? "" : split.body;
  return `---\n${yamlText}---\n${tail}`;
}

// CLI entry — only when run directly (e.g. spawned by `bbx migrate`), not when
// imported by a test. Uses the shared harness for arg parsing / walk / counts.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runMigration({
    description:
      "Normalize card refs onto a `ref` key: landmark procedure-ref → procedure.ref; webpage/commentary frozen string → frozen.ref.",
    match: (name) => {
      const type = cardType(name);
      return type === "landmark" || type === "webpage" || type === "commentary";
    },
    convert: async (file, { apply }) => {
      const rewritten = rewriteCardText(basename(file), await readFile(file, "utf8"));
      if (rewritten === null) return "already";
      if (apply) await writeFile(file, rewritten);
      return "converted";
    },
  });
}
