#!/usr/bin/env tsx
/* eslint-disable import/no-namespace, security/detect-non-literal-fs-filename */
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
 * Usage:
 *   pnpm exec tsx scripts/migrate/normalize-ref-keys.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/normalize-ref-keys.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Split a card's frontmatter text from its body. Returns null if no frontmatter. */
function splitCard(raw: string): { fm: string; body: string } | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
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

async function findCardFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".card")) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const boxRoot = positional[0];
  if (boxRoot === undefined) {
    console.error("Usage: normalize-ref-keys <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = path.resolve(boxRoot);
  const cardFiles = await findCardFiles(absRoot);

  const toRewrite: string[] = [];
  for (const file of cardFiles) {
    const raw = await fs.readFile(file, "utf8");
    const rewritten = rewriteCardText(path.basename(file), raw);
    if (rewritten !== null) {
      toRewrite.push(file);
      if (apply) await fs.writeFile(file, rewritten);
    }
  }

  console.log(`Found ${String(cardFiles.length)} .card files under ${absRoot}`);
  console.log(`  ${String(toRewrite.length)} need ref-key normalization`);
  for (const f of toRewrite.slice(0, 20)) {
    console.log("  " + path.relative(absRoot, f));
  }
  if (toRewrite.length > 20) {
    console.log(`  ... and ${String(toRewrite.length - 20)} more`);
  }
  if (!apply) {
    console.log("\nDry run. Run with --apply to write changes.");
  } else {
    console.log(`\nRewrote ${String(toRewrite.length)} files.`);
  }
}

// CLI entry — only when run directly, not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
