#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Migrate box-local `*.bill.card` files from the XML body format to all-YAML
 * frontmatter. `bill` is an ledger box-local card type (its schema lives in the
 * box at `config/schemas/bill.ts`).
 *
 * Old (XML body):
 *   ---
 *   content-type: application/x-card+xml
 *   ---
 *   <bill status="paid">
 *     <vendor>Fairview Health Services</vendor>
 *     <amount value="3038.95" currency="USD"/>
 *     <due value="upon-receipt"/>
 *     <auto-pay>false</auto-pay>
 *     <account>4690929</account>
 *     <service-address>…</service-address>
 *     <payment><date value="2026-03-19"/><method>check</method><check-number>8010</check-number></payment>
 *     <sources><source ref="…">desc</source></sources>
 *     <notes>…</notes>
 *   </bill>
 *
 * New (frontmatter): status/vendor/amount/currency/due/auto-pay/account/
 *   service-address/payment/sources/notes as flat YAML fields.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/bill.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/bill.ts <boxRoot> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseCard, splitCardContent, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";
import { checkElement, type ElementSpec } from "./_warnings.js";

const SPEC: ElementSpec = {
  attrs: ["status"],
  children: {
    vendor: { attrs: [] },
    amount: { attrs: ["value", "currency"] },
    due: { attrs: ["value"] },
    "auto-pay": { attrs: [] },
    account: { attrs: [] },
    "service-address": { attrs: [] },
    payment: {
      attrs: [],
      children: {
        date: { attrs: ["value"] },
        method: { attrs: [] },
        "check-number": { attrs: [] },
        amount: { attrs: ["value", "currency"] },
        source: { attrs: ["ref"] },
      },
    },
    sources: {
      attrs: [],
      children: { source: { attrs: ["ref"] } },
    },
    notes: { attrs: [] },
  },
};

function text(el: ElementNode): string {
  return typeof el.text === "string" ? el.text.trim() : "";
}
function child(el: ElementNode, tag: string): ElementNode | undefined {
  return el.children.find((c) => c.tagName === tag);
}
function attr(el: ElementNode, name: string): string | undefined {
  const v = el.attrs[name];
  return typeof v === "string" && v !== "" ? v : undefined;
}

function convertSources(el: ElementNode): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const s of el.children.filter((c) => c.tagName === "source")) {
    const ref = attr(s, "ref");
    if (ref === undefined) continue;
    const entry: Record<string, unknown> = { ref };
    const note = text(s);
    if (note !== "") entry.note = note;
    out.push(entry);
  }
  return out;
}

function convertPayment(el: ElementNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const dateEl = child(el, "date");
  if (dateEl !== undefined) {
    const v = attr(dateEl, "value");
    if (v !== undefined) out.date = v;
  }
  const methodEl = child(el, "method");
  if (methodEl !== undefined) {
    const t = text(methodEl);
    if (t !== "") out.method = t;
  }
  const checkEl = child(el, "check-number");
  if (checkEl !== undefined) {
    const t = text(checkEl);
    if (t !== "") out["check-number"] = t;
  }
  const amountEl = child(el, "amount");
  if (amountEl !== undefined) {
    const v = attr(amountEl, "value");
    if (v !== undefined) out.amount = v;
  }
  const sourceEl = child(el, "source");
  if (sourceEl !== undefined) {
    const r = attr(sourceEl, "ref");
    if (r !== undefined) out.source = { ref: r };
  }
  return out;
}

await runMigration({
  description: "Convert box-local *.bill.card XML body → all-YAML frontmatter.",
  match: (name) => name.endsWith(".bill.card"),
  convert: async (absPath, { warnings, apply }) => {
    const content = await readFile(absPath, "utf-8");
    const split = splitCardContent(content);
    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
    if (split.hasFrontmatter && !isXml) {
      // Already frontmatter (no XML content-type marker).
      return "already";
    }

    const root = await parseCard(content, { source: absPath });
    if (root.tagName !== "bill") {
      throw new Error(`expected <bill> root, got <${root.tagName}>`);
    }
    checkElement({ node: root, source: absPath, spec: SPEC, warnings });

    const fields: Record<string, unknown> = {};
    const status = attr(root, "status");
    fields.status = status === undefined ? "unpaid" : status;

    const vendorEl = child(root, "vendor");
    if (vendorEl !== undefined) {
      const t = text(vendorEl);
      if (t !== "") fields.vendor = t;
    }
    const amountEl = child(root, "amount");
    if (amountEl !== undefined) {
      const v = attr(amountEl, "value");
      if (v !== undefined) fields.amount = v;
      const c = attr(amountEl, "currency");
      if (c !== undefined) fields.currency = c;
    }
    const dueEl = child(root, "due");
    if (dueEl !== undefined) {
      const v = attr(dueEl, "value");
      if (v !== undefined) fields.due = v;
    }
    const autoPayEl = child(root, "auto-pay");
    if (autoPayEl !== undefined) {
      const t = text(autoPayEl);
      if (t !== "") fields["auto-pay"] = t === "true";
    }
    const accountEl = child(root, "account");
    if (accountEl !== undefined) {
      const t = text(accountEl);
      if (t !== "") fields.account = t;
    }
    const addrEl = child(root, "service-address");
    if (addrEl !== undefined) {
      const t = text(addrEl);
      if (t !== "") fields["service-address"] = t;
    }
    const paymentEl = child(root, "payment");
    if (paymentEl !== undefined) {
      const p = convertPayment(paymentEl);
      if (Object.keys(p).length > 0) fields.payment = p;
    }
    const sourcesEl = child(root, "sources");
    if (sourcesEl !== undefined) {
      const s = convertSources(sourcesEl);
      if (s.length > 0) fields.sources = s;
    }
    const notesEl = child(root, "notes");
    if (notesEl !== undefined) {
      const t = text(notesEl);
      if (t !== "") fields.notes = t;
    }

    const out = `---\n${stringifyYaml(fields)}---\n`;
    if (apply) await writeFile(absPath, out, "utf-8");
    return "converted";
  },
});
