#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Retype the recipe card's `source:` and `hero-image:` from freeform strings to
 * typed objects.
 *
 *   source: "The Kitchen"            → source: { label: "The Kitchen" }
 *   source: "https://…/stew"         → source: { href: "https://…/stew" }
 *   hero-image: "attach/finished.jpg" → hero-image: { ref: "attach/finished.jpg" }
 *   hero-image: "https://…/photo.jpg" → hero-image: { href: "https://…/photo.jpg" }
 *
 * A URL-looking value (http/https) becomes `href`; anything else becomes
 * `label` for `source` (a cookbook/person name) and `ref` for `hero-image` (a
 * path into the card's attach scope). Both are single-string → single-field, so
 * there is no data loss.
 *
 * Idempotent: a card whose `source`/`hero-image` is already an object (or
 * absent) is left untouched. Registered in src/core/migrations.ts. Also:
 *   pnpm exec tsx scripts/migrate/recipe-source-shape.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/recipe-source-shape.ts <boxRoot> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function splitCard(raw: string): { fm: string; body: string } | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (m === null) return null;
  return { fm: m[1] === undefined ? "" : m[1], body: m[2] === undefined ? "" : m[2] };
}

const URL_RE = /^https?:\/\//i;

/** Rewrite one recipe card's text, or null if nothing changed. Exported for tests. */
export function rewriteRecipeText(fileName: string, raw: string): string | null {
  if (!fileName.endsWith(".recipe.card")) return null;
  const split = splitCard(raw);
  if (split === null) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(split.fm);
  } catch (_e) {
    return null;
  }
  if (!isRecord(parsed)) return null;

  let changed = false;

  const source = parsed["source"];
  if (typeof source === "string" && source !== "") {
    parsed["source"] = URL_RE.test(source) ? { href: source } : { label: source };
    changed = true;
  }

  const hero = parsed["hero-image"];
  if (typeof hero === "string" && hero !== "") {
    parsed["hero-image"] = URL_RE.test(hero) ? { href: hero } : { ref: hero };
    changed = true;
  }

  if (!changed) return null; // idempotent: already objects, or absent
  const yamlText = stringifyYaml(parsed);
  return `---\n${yamlText}---\n${split.body}`;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runMigration({
    description: "*.recipe.card: retype string source/hero-image to typed objects.",
    match: (name) => name.endsWith(".recipe.card"),
    convert: async (file, { apply }) => {
      const rewritten = rewriteRecipeText(basename(file), await readFile(file, "utf8"));
      if (rewritten === null) return "already";
      if (apply) await writeFile(file, rewritten);
      return "converted";
    },
  });
}
