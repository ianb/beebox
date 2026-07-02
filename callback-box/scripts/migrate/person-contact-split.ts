#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Split the person card's freeform `contact:` string into structured optional
 * `email:` / `phone:` / `address:` scalars.
 *
 * The real data is mixed — pure addresses, "address · phone", multi-line blocks
 * with two emails and annotations, labeled "Phone:/Fax:/Email:", and even
 * biographical misuse ("London, England (1791–1871)"). Scalars hold one value
 * apiece, so this migrator is deliberately **conservative and noisy**:
 *
 *   - It structures only what it can classify confidently (a bare email, a
 *     phone-shaped value, a postal-looking address).
 *   - Anything it can't place cleanly — a second email, a fax, annotations, a
 *     vague locale, biographical text — is preserved verbatim in the card body
 *     under a `## Contact` note, and reported as a warning so a human reviews it.
 *
 * Nothing is dropped: every card that produced a warning kept its unmapped text
 * in the body. Idempotent: a card with no `contact:` key is left untouched.
 * Registered in src/core/migrations.ts. Also:
 *   pnpm exec tsx scripts/migrate/person-contact-split.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/person-contact-split.ts <boxRoot> --apply
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

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LABEL_RE = /^\s*(phone|tel|mobile|cell|fax|e-?mail|address|addr)\s*:\s*(.*)$/i;
// A street-type word (single alternation of literals — linear, no backtracking).
const STREET_WORD_RE =
  /\b(ave|avenue|st|street|rd|road|ln|lane|blvd|boulevard|dr|drive|apt|suite|ste|way|ct|court|pl|place|cir|circle|hwy|highway|pkwy|parkway)\b/i;
const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;

function isPhone(v: string): boolean {
  // en-dash deliberately excluded so a year range ("1791–1871") isn't a phone
  if (!/^[+(]?\d[\d\s().+-]{5,}\d$/.test(v.trim())) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function isAddress(v: string): boolean {
  // A ZIP, or a leading street number plus a street-type word.
  return ZIP_RE.test(v) || (/^\d/.test(v.trim()) && STREET_WORD_RE.test(v));
}

interface Extracted {
  email?: string;
  phone?: string;
  address?: string;
  residual: string[];
}

/** Classify one contact segment into the accumulator, or push it to residual. */
function classifySegment(seg: string, acc: Extracted): void {
  const labeled = seg.match(LABEL_RE);
  const label = labeled ? labeled[1]!.toLowerCase().replace("-", "") : null;
  const value = labeled ? labeled[2]!.trim() : seg;

  if (label === "fax") {
    acc.residual.push(seg);
    return;
  }
  const emails = value.match(EMAIL_RE);
  if ((emails !== null && emails.length > 0) || label === "email") {
    const first = emails === null ? undefined : emails[0];
    if (acc.email === undefined && first !== undefined) acc.email = first;
    // Clean only when the segment is exactly the one bare email we just took.
    const clean = emails !== null && emails.length === 1 && value === first && acc.email === first;
    if (!clean) acc.residual.push(seg);
    return;
  }
  const labelIsPhone = label === "phone" || label === "tel" || label === "mobile" || label === "cell";
  if (labelIsPhone || isPhone(value)) {
    if (acc.phone === undefined && isPhone(value)) acc.phone = value;
    else acc.residual.push(seg);
    return;
  }
  if (label === "address" || label === "addr" || isAddress(value)) {
    if (acc.address === undefined && value !== "") acc.address = value;
    else acc.residual.push(seg);
    return;
  }
  acc.residual.push(seg); // unclassified — biographical, vague locale, etc.
}

/**
 * Split one person card's `contact:` into email/phone/address, moving anything
 * unmappable into the body. Returns null when there's nothing to do (not a
 * person card, no `contact` key, or unparseable). Exported for tests.
 */
export function rewritePersonContact(
  fileName: string,
  raw: string,
): { text: string; residual: string[] } | null {
  if (!fileName.endsWith(".person.card")) return null;
  const split = splitCard(raw);
  if (split === null) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(split.fm);
  } catch (_e) {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!("contact" in parsed)) return null; // idempotent

  const contact = parsed["contact"];
  delete parsed["contact"];

  const acc: Extracted = { residual: [] };
  if (typeof contact === "string" && contact.trim() !== "") {
    const segments = contact
      .split(/\r?\n/)
      .flatMap((line) => line.split(/\s*·\s*/))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const seg of segments) classifySegment(seg, acc);
  }

  if (acc.email !== undefined) parsed["email"] = acc.email;
  if (acc.phone !== undefined) parsed["phone"] = acc.phone;
  if (acc.address !== undefined) parsed["address"] = acc.address;

  let body = split.body;
  if (acc.residual.length > 0) {
    const note = `## Contact\n\n${acc.residual.map((r) => `- ${r}`).join("\n")}\n`;
    const base = body.trimEnd();
    body = base === "" ? note : `${base}\n\n${note}`;
  }

  const yamlText = stringifyYaml(parsed);
  return { text: `---\n${yamlText}---\n${body}`, residual: acc.residual };
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await runMigration({
    description: "*.person.card: split freeform `contact:` into email/phone/address.",
    match: (name) => name.endsWith(".person.card"),
    convert: async (file, { apply, warnings }) => {
      const result = rewritePersonContact(basename(file), await readFile(file, "utf8"));
      if (result === null) return "already";
      if (result.residual.length > 0) {
        warnings.push(file, `contact text moved to body (review): ${result.residual.join(" | ")}`);
      }
      if (apply) await writeFile(file, result.text);
      return "converted";
    },
  });
}
