#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Migrate `run.procedure-run.card` files from the XML body format to
 * Phase-2 frontmatter (pure YAML, no body).
 *
 * Run cards are a transient cache (gc deletes them; git history is the
 * archive), so this is mostly for tidiness — unmigrated run cards age out
 * on their own.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/procedure-run.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/procedure-run.ts <boxRoot> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseCard, splitCardContent, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const PHASE_RESULT: ElementSpec = {
  attrs: [],
  children: {
    stdout: { attrs: [] },
    "session-id": { attrs: [] },
    "git-ref": { attrs: [] },
    review: { attrs: [] },
  },
};

const SPEC: ElementSpec = {
  attrs: ["procedure", "status", "started-at", "completed-at", "directive", "expires"],
  children: {
    step: {
      attrs: ["id", "status", "started-at", "completed-at"],
      children: {
        precheck: { attrs: ["status"], children: PHASE_RESULT.children },
        run: { attrs: [], children: PHASE_RESULT.children },
        validate: { attrs: ["status"], children: PHASE_RESULT.children },
      },
    },
  },
};

function text(el: ElementNode): string {
  return typeof el.text === "string" ? el.text.trim() : "";
}

function childText(el: ElementNode, tag: string): string | undefined {
  const found = el.children.find((c) => c.tagName === tag);
  if (found === undefined) return undefined;
  const t = text(found);
  return t === "" ? undefined : t;
}

function copyAttr(from: ElementNode, name: string, into: Record<string, unknown>, key: string): void {
  const v = from.attrs[name];
  if (typeof v === "string" && v !== "") into[key] = v;
}

function convertPhase(phase: ElementNode | undefined, kind: "precheck" | "run" | "validate"): Record<string, unknown> | undefined {
  if (phase === undefined) return undefined;
  const out: Record<string, unknown> = {};
  if (kind !== "run") copyAttr(phase, "status", out, "status");
  const stdout = childText(phase, "stdout");
  if (stdout !== undefined) out.stdout = stdout;
  if (kind === "run") {
    const sessionId = childText(phase, "session-id");
    if (sessionId !== undefined) out["session-id"] = sessionId;
    const gitRef = childText(phase, "git-ref");
    if (gitRef !== undefined) out["git-ref"] = gitRef;
  }
  if (kind === "validate") {
    const review = childText(phase, "review");
    if (review !== undefined) out.review = review;
  }
  return out;
}

function convertStep(step: ElementNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  copyAttr(step, "id", out, "id");
  copyAttr(step, "status", out, "status");
  copyAttr(step, "started-at", out, "started-at");
  copyAttr(step, "completed-at", out, "completed-at");
  const precheck = convertPhase(step.children.find((c) => c.tagName === "precheck"), "precheck");
  if (precheck !== undefined) out.precheck = precheck;
  const run = convertPhase(step.children.find((c) => c.tagName === "run"), "run");
  if (run !== undefined) out.run = run;
  const validate = convertPhase(step.children.find((c) => c.tagName === "validate"), "validate");
  if (validate !== undefined) out.validate = validate;
  return out;
}

await runMigration({
  description: "Convert run.procedure-run.card XML body → frontmatter (pure YAML).",
  match: (name) => name === "run.procedure-run.card",
  convert: async (absPath, { warnings, apply }) => {
    const content = await readFile(absPath, "utf-8");
    const split = splitCardContent(content);
    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
    if (split.hasFrontmatter && !isXml) return "already";

    const root = await parseCard(content, { source: absPath });
    if (root.tagName !== "procedure-run") {
      throw new Error(`expected <procedure-run> root, got <${root.tagName}>`);
    }
    checkElement({ node: root, source: absPath, spec: SPEC, warnings });

    const fields: Record<string, unknown> = {};
    copyAttr(root, "procedure", fields, "procedure");
    copyAttr(root, "status", fields, "status");
    copyAttr(root, "started-at", fields, "started-at");
    copyAttr(root, "completed-at", fields, "completed-at");
    copyAttr(root, "directive", fields, "directive");
    copyAttr(root, "expires", fields, "expires");
    fields.steps = root.children.filter((c) => c.tagName === "step").map(convertStep);

    const out = `---\n${stringifyYaml(fields)}---\n`;
    if (apply) await writeFile(absPath, out, "utf-8");
    return "converted";
  },
});
