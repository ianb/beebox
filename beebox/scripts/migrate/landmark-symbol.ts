#!/usr/bin/env tsx
/**
 * `*.landmark.card`: `navigation.symbol` → the card's own `symbol` group.
 *
 * A landmark's mark used to be the only card mark in the box, nested inside the
 * navigation role as `string | { src }`. It is now the global `symbol` field
 * every card may carry (`src/shared/card-symbol.ts`), so landmarks stop being
 * the special case:
 *
 *   navigation:              →   symbol:
 *     symbol: 🍳                   glyph: 🍳
 *
 *   navigation:              →   symbol:
 *     symbol:                      src: /_content/…/mark.webp
 *       src: /_content/…
 *
 * Idempotent by content: a card with no `navigation.symbol` left is "already".
 * A card that somehow carries both keeps its own `symbol` and drops the nested
 * one, since the readers already prefer the card's own.
 *
 * Deliberately not merged into one YAML rewrite of the whole file: the edit is
 * surgical (two keys) and `parse`→`stringify` would reorder and reflow every
 * other key in the card, turning a two-line change into a whole-file diff on
 * cards a person hand-authored.
 */

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse as parseYaml, isMap, parseDocument } from "yaml";
import { runMigration } from "./_harness.js";
import { isRecord } from "../../src/lib/is-record.js";

export interface RewriteResult {
  /** The card's new text, or null when nothing needed moving. */
  text: string | null;
  /** Anything the move could not carry, for the harness's warning dump. */
  warnings: string[];
}

/**
 * The whole decision, as a pure function of the card's text — so a doctest can
 * reach every shape (text symbol, image symbol, none, already moved, both) with
 * no box on disk. `convert` below is the IO around it.
 */
export function rewriteLandmarkSymbol(original: string): RewriteResult {
  const warnings: string[] = [];
  const match = /^---\n([\S\s]*?)\n---(\n[\S\s]*)?$/.exec(original);
  if (match === null) return { text: null, warnings };
  const frontmatterText = match[1] ?? "";
  const rest = match[2] ?? "\n";

  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatterText);
  } catch (e) {
    warnings.push(`frontmatter does not parse as YAML: ${e instanceof Error ? e.message : String(e)}`);
    return { text: null, warnings };
  }
  if (!isRecord(parsed)) return { text: null, warnings };
  const navigation = parsed["navigation"];
  if (!isRecord(navigation) || navigation["symbol"] === undefined) return { text: null, warnings };

  const legacy = navigation["symbol"];
  let moved: Record<string, string> | null = null;
  if (typeof legacy === "string") {
    const glyph = legacy.trim();
    if (glyph !== "") moved = { glyph };
  } else if (isRecord(legacy) && typeof legacy["src"] === "string") {
    moved = { src: legacy["src"] };
  } else {
    warnings.push(`navigation.symbol is neither text nor { src } — dropping: ${JSON.stringify(legacy)}`);
  }
  if (moved !== null && isRecord(parsed["symbol"])) {
    warnings.push("card already has its own symbol — keeping it and dropping navigation.symbol");
    moved = null;
  }

  // Edit the YAML document in place so untouched keys keep their formatting.
  const doc = parseDocument(frontmatterText);
  const nav = doc.get("navigation");
  if (isMap(nav)) nav.delete("symbol");
  if (isMap(nav) && nav.items.length === 0) doc.delete("navigation");
  if (moved !== null) doc.set("symbol", doc.createNode(moved));
  // `lineWidth: 0` keeps yaml from reflowing long scalars elsewhere in the
  // block (a long `rules:` string) — the edit must stay surgical.
  const text = `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---${rest}`;
  return { text: text === original ? null : text, warnings };
}

// CLI entry — only when run directly, not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigration({
    description: "*.landmark.card: navigation.symbol → the card's own symbol group.",
    match: (name) => name.endsWith(".landmark.card"),
    convert: async (absPath, { warnings, apply }) => {
      const original = await readFile(absPath, "utf8");
      const { text, warnings: found } = rewriteLandmarkSymbol(original);
      for (const message of found) warnings.push(absPath, message);
      if (text === null) return "already";
      if (apply) await writeFile(absPath, text, "utf8");
      return "converted";
    },
  });
}
