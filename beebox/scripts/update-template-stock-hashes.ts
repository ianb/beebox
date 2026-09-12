#!/usr/bin/env tsx
/**
 * Reconcile `src/core/template-stock-hashes.ts` with the live managed template
 * constants. Run this after changing a template guide (VIEWS_CLAUDE_MD,
 * SCHEMAS_CLAUDE_MD, …): for each managed template whose content hash no longer
 * matches the ledger's `current`, it moves the old `current` into `superseded`
 * (so field boxes carrying it still overwrite cleanly) and records the new hash.
 *
 * This is the ONLY sanctioned way to update the ledger — doing it by hand risks
 * dropping the superseded hash, which is exactly the silent-parking bug this
 * whole mechanism exists to prevent. The forcing-function test
 * (`test/core/template-stock-hashes.doctest.md`) fails until the ledger matches,
 * pointing you here.
 *
 *   pnpm template-stock:update            # apply
 *   pnpm template-stock:update --check    # exit 1 if out of date (no writes)
 *   pnpm template-stock:update --adopt <name>=<sha256>   # record a version
 *                                         # that shipped before the ledger saw it
 *
 * `--adopt` exists because the forward-only path above cannot see its own past.
 * The ledger only ever learns a hash by retiring a `current` it recorded, so a
 * version that shipped BEFORE the ledger covered that template — or under a
 * different constant, as the 2026-08 rename produced — is unknown to it
 * forever. A box carrying one looks customized to `installTemplateFile` and
 * parks silently, which is the exact bug this mechanism exists to prevent
 * (found 2026-09-12: three boxes holding pre-rename stock copies of the
 * schemas guide, none of their hashes in the ledger).
 *
 * Adopt only a hash you have CONFIRMED is stock — identical across boxes, or
 * diffing against the current template as pure template evolution. Adopting a
 * boxholder's customization would overwrite their edit on the next `bbx init`.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { MANAGED_STOCK_TEMPLATES } from "../src/core/box/templates.js";
import {
  TEMPLATE_STOCK_HASHES,
  type TemplateStockEntry,
} from "../src/core/template-stock-hashes.js";

const LEDGER_PATH = path.join(
  import.meta.dirname,
  "..",
  "src",
  "core",
  "template-stock-hashes.ts",
);

const HEADER = `/**
 * Stock-hash ledger for template files that ship via \`installTemplateFile\` with
 * a \`priorStockHashes\` allowlist (the box-local CLAUDE.md guides).
 *
 * GENERATED DATA — do not hand-edit. Run \`pnpm template-stock:update\` after
 * changing one of these template constants; it moves the superseded hash into
 * \`superseded[]\` and records the new \`current\`. A test
 * (\`test/core/template-stock-hashes.doctest.md\`) fails if a template constant
 * changes without this ledger being updated, which is the forcing function that
 * keeps \`priorStockHashes\` complete: a field box carrying ANY superseded version
 * is then recognized as unmodified stock and cleanly overwritten on \`bbx init\`
 * (rather than silently parking under \`config/_template-updates/\`).
 *
 * \`current\` is the sha256 of the live template constant; \`superseded\` is every
 * hash we ever shipped before it (this is what \`installTemplateFile\` receives as
 * \`priorStockHashes\`).
 */

export interface TemplateStockEntry {
  /** sha256 of the current template constant (what a fresh box gets). */
  current: string;
  /** sha256s of every prior shipped version — passed as \`priorStockHashes\`. */
  superseded: string[];
}
`;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Serialize the ledger to the canonical file text (stable key + array order). */
function render(ledger: Record<string, TemplateStockEntry>): string {
  const keys = Object.keys(ledger).toSorted();
  const entries = keys.map((k) => {
    const e = ledger[k]!;
    const sup = e.superseded.map((h) => `      "${h}",`).join("\n");
    return `  ${JSON.stringify(k)}: {\n    current: "${e.current}",\n    superseded: [\n${sup}\n    ],\n  },`;
  });
  // `satisfies` (not a `Record<string, …>` annotation) so the keys stay
  // literal: `keyof typeof TEMPLATE_STOCK_HASHES` types MANAGED_STOCK_TEMPLATES'
  // `name`, and a `TEMPLATE_STOCK_HASHES["x"].superseded` read needs no
  // undefined-check under `noUncheckedIndexedAccess`.
  return `${HEADER}\nexport const TEMPLATE_STOCK_HASHES = {\n${entries.join("\n")}\n} satisfies Record<string, TemplateStockEntry>;\n`;
}

/** A malformed `--adopt` argument. Its detail names the offending value. */
class AdoptArgumentError extends Error {
  constructor() {
    super("--adopt expects <name>=<sha256>");
    this.name = "AdoptArgumentError";
  }
  /** The offending argument, for the operator — not part of the message. */
  detail = "";
  static for(detail: string): AdoptArgumentError {
    const error = new AdoptArgumentError();
    error.detail = detail;
    return error;
  }
}

/** `--adopt` named a template the ledger does not track. */
class UnknownTemplateError extends Error {
  constructor() {
    super("--adopt names a template that is not in the ledger");
    this.name = "UnknownTemplateError";
  }
  /** The name that was not found. */
  templateName = "";
  static for(templateName: string): UnknownTemplateError {
    const error = new UnknownTemplateError();
    error.templateName = templateName;
    return error;
  }
}

/** `--adopt name=hash` pairs, validated. Empty when the flag is absent. */
function parseAdoptions(argv: string[]): Array<{ name: string; hash: string }> {
  const out: Array<{ name: string; hash: string }> = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--adopt") continue;
    const value = argv[i + 1];
    if (value === undefined) throw AdoptArgumentError.for("missing value");
    const eq = value.indexOf("=");
    if (eq === -1) throw AdoptArgumentError.for(value);
    const name = value.slice(0, eq);
    const hash = value.slice(eq + 1);
    if (!/^[\da-f]{64}$/.test(hash)) throw AdoptArgumentError.for(`${name}=${hash}`);
    out.push({ name, hash });
  }
  return out;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const adoptions = parseAdoptions(process.argv);

  // Deep-clone the current ledger so we mutate a copy.
  const next: Record<string, TemplateStockEntry> = {};
  for (const [k, v] of Object.entries(TEMPLATE_STOCK_HASHES)) {
    next[k] = { current: v.current, superseded: [...v.superseded] };
  }

  const changed: string[] = [];
  for (const tpl of MANAGED_STOCK_TEMPLATES) {
    const hash = sha256(tpl.content);
    const entry = next[tpl.name] ?? { current: "", superseded: [] };
    if (Object.is(entry.current, hash)) {
      next[tpl.name] = entry;
      continue;
    }
    // Content drifted: retire the old current into superseded (dedup), adopt new.
    if (entry.current !== "" && !entry.superseded.includes(entry.current)) {
      entry.superseded.push(entry.current);
    }
    entry.current = hash;
    next[tpl.name] = entry;
    changed.push(tpl.name);
  }

  for (const { name, hash } of adoptions) {
    const entry = next[name];
    if (!entry) throw UnknownTemplateError.for(name);
    if (Object.is(entry.current, hash)) {
      console.log(`${name}: ${hash.slice(0, 12)} is already \`current\` — nothing to adopt.`);
      continue;
    }
    if (entry.superseded.includes(hash)) {
      console.log(`${name}: ${hash.slice(0, 12)} is already recorded.`);
      continue;
    }
    entry.superseded.push(hash);
    changed.push(`${name} (adopted ${hash.slice(0, 12)})`);
  }

  const rendered = render(next);
  const existing = await readFile(LEDGER_PATH, "utf-8").catch(() => "");

  if (rendered === existing) {
    console.log("template-stock-hashes.ts is up to date.");
    return;
  }

  if (check) {
    console.error(
      `template-stock-hashes.ts is OUT OF DATE (changed: ${changed.join(", ") || "formatting"}).\n` +
        "Run `pnpm template-stock:update` to record the superseded hash(es).",
    );
    process.exit(1);
  }

  await writeFile(LEDGER_PATH, rendered);
  console.log(
    "Updated template-stock-hashes.ts" +
      (changed.length > 0 ? ` (retired prior hash for: ${changed.join(", ")}).` : " (formatting)."),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
