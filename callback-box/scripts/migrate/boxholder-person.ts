#!/usr/bin/env tsx
/**
 * Move boxholder identity out of the personality card onto person cards.
 *
 * The personality card used to embed the boxholder inline as
 * `boxholder: { full-name, called, ref }` — a single-boxholder model. Who
 * the boxholder is now lives on `people/*.person.card` files flagged
 * `boxholder: true` (the plural-capable single source of truth), and the
 * compiled "Your boxholder is …" line is generated from those. The
 * personality card keeps only the relational notes (`boxholder.relationships`).
 *
 * This migrator, for each `*.personality.card`:
 *   1. If `boxholder.full-name` (or `boxholder.ref`) is set, find-or-create
 *      the matching `people/First_Last.person.card`, set `boxholder: true`,
 *      and fold `called` into `aliases`. Data moves, never lost.
 *   2. Strips `full-name`/`called`/`ref` from the personality card's
 *      `boxholder`, keeping `relationships` (or dropping the now-empty key).
 *
 * Idempotent: a personality card whose `boxholder` has none of those legacy
 * keys is left untouched. A box with no personality card is a no-op.
 *
 * Registered in src/core/migrations.ts. Also runnable directly:
 *   pnpm exec tsx scripts/migrate/boxholder-person.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/boxholder-person.ts <boxRoot> --apply
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Split a card's frontmatter text from its body. Returns null if no frontmatter. */
function splitCard(raw: string): { fm: string; body: string } | null {
  const m = raw.match(/^---\r?\n([\S\s]*?)\r?\n---\r?\n?([\S\s]*)$/);
  if (m === null) return null;
  return { fm: m[1] === undefined ? "" : m[1], body: m[2] === undefined ? "" : m[2] };
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Absolute path to the person card a boxholder ref/name resolves to. */
function personCardPath(boxRoot: string, { ref, fullName }: { ref: string; fullName: string }): string {
  if (ref !== "") {
    const rel = ref.replace(/^\.?\/+/, "");
    return join(boxRoot, rel.endsWith(".person.card") ? rel : `${rel}.person.card`);
  }
  return join(boxRoot, "people", `${fullName.trim().replace(/\s+/g, "_")}.person.card`);
}

/**
 * Create the boxholder person card if absent, or flag an existing one. Folds
 * `called` into `aliases`. Returns without writing when `apply` is false. A
 * malformed existing card is left untouched (surfaced by `cb validate`).
 */
async function upsertBoxholderPerson(
  personPath: string,
  { name, called, apply }: { name: string; called: string; apply: boolean },
): Promise<void> {
  let existing: string | null = null;
  try {
    existing = await readFile(personPath, "utf8");
  } catch (e) {
    const isEnoent = e !== null && typeof e === "object" && "code" in e && e.code === "ENOENT";
    if (!isEnoent) throw e;
  }

  if (existing === null) {
    const fields: Record<string, unknown> = { status: "active", name, boxholder: true };
    if (called !== "") fields["aliases"] = [called];
    if (apply) {
      await mkdir(dirname(personPath), { recursive: true });
      await writeFile(personPath, `---\n${stringifyYaml(fields)}---\n`);
    }
    return;
  }

  const split = splitCard(existing);
  if (split === null) return;
  let parsed: unknown;
  try {
    parsed = parseYaml(split.fm);
  } catch (_e) {
    return;
  }
  if (!isRecord(parsed)) return;
  parsed["boxholder"] = true;
  if (called !== "") {
    const prev = parsed["aliases"];
    const aliases = Array.isArray(prev) ? prev.map((v) => String(v)) : [];
    if (!aliases.includes(called)) aliases.push(called);
    parsed["aliases"] = aliases;
  }
  if (apply) await writeFile(personPath, `---\n${stringifyYaml(parsed)}---\n${split.body}`);
}

// CLI entry — only when run directly (e.g. spawned by `cb migrate`), not when
// imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runMigration({
    description: "*.personality.card: move inline boxholder identity onto person cards (boxholder: true).",
    match: (name) => name.endsWith(".personality.card"),
    convert: async (file, { apply }) => {
      const split = splitCard(await readFile(file, "utf8"));
      if (split === null) return "already";
      let parsed: unknown;
      try {
        parsed = parseYaml(split.fm);
      } catch (_e) {
        return "already";
      }
      if (!isRecord(parsed)) return "already";
      const boxholder = parsed["boxholder"];
      if (!isRecord(boxholder)) return "already";

      const hasLegacy = "full-name" in boxholder || "called" in boxholder || "ref" in boxholder;
      if (!hasLegacy) return "already"; // idempotent

      const fullName = trimStr(boxholder["full-name"]);
      const called = trimStr(boxholder["called"]);
      const ref = trimStr(boxholder["ref"]);
      const boxRoot = dirname(dirname(file)); // <box>/config/<name>.personality.card

      if (fullName !== "" || ref !== "") {
        await upsertBoxholderPerson(personCardPath(boxRoot, { ref, fullName }), { name: fullName, called, apply });
      }

      delete boxholder["full-name"]; delete boxholder["called"]; delete boxholder["ref"];
      const relationships = boxholder["relationships"];
      if (Array.isArray(relationships) && relationships.length > 0) {
        parsed["boxholder"] = { relationships };
      } else {
        delete parsed["boxholder"];
      }
      if (apply) await writeFile(file, `---\n${stringifyYaml(parsed)}---\n${split.body}`);
      return "converted";
    },
  });
}
