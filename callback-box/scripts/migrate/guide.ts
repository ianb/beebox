#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Migrate `.guide.card` files from the XML body format to Phase-2
 * frontmatter (pure YAML, no body).
 *
 * Everything in a guide is structured metadata, so the XML elements map
 * directly onto YAML fields: triage rules with their per-rule
 * confidence/source, named actions, experiments (with observations),
 * reactions, and context notes.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/guide.ts <root>           # dry-run
 *   pnpm exec tsx scripts/migrate/guide.ts <root> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseCard, splitCardContent, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const SPEC: ElementSpec = {
  attrs: ["version", "job-types"],
  children: {
    "applies-to": { attrs: [] },
    triage: {
      attrs: [],
      children: {
        rule: { attrs: ["confidence", "source", "ref", "action"] },
        "default-action": { attrs: ["action"] },
      },
    },
    actions: {
      attrs: [],
      children: { action: { attrs: ["name"], children: { when: { attrs: [] }, instructions: { attrs: [] } } } },
    },
    experiments: {
      attrs: [],
      children: {
        experiment: {
          attrs: ["id", "status", "created-at", "updated-at"],
          children: {
            hypothesis: { attrs: [] },
            approach: { attrs: [] },
            "tested-in": { attrs: ["ref", "date"] },
            observation: { attrs: ["ref", "date"] },
            conclusion: { attrs: [] },
          },
        },
      },
    },
    reactions: { attrs: [], children: { reaction: { attrs: ["id", "sentiment"] } } },
    "context-notes": { attrs: [], children: { context: { attrs: ["duration", "added-at"] } } },
  },
};

function text(el: ElementNode): string {
  return typeof el.text === "string" ? el.text.trim() : "";
}

function child(el: ElementNode, tag: string): ElementNode | undefined {
  return el.children.find((c) => c.tagName === tag);
}

function childText(el: ElementNode, tag: string): string | undefined {
  const found = child(el, tag);
  if (found === undefined) return undefined;
  const t = text(found);
  return t === "" ? undefined : t;
}

function strAttr(el: ElementNode, name: string): string | undefined {
  const v = el.attrs[name];
  return typeof v === "string" && v !== "" ? v : undefined;
}

function put(obj: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value !== undefined) obj[key] = value;
}

function convertRule(r: ElementNode): Record<string, unknown> {
  const out: Record<string, unknown> = { text: text(r) };
  put(out, "confidence", strAttr(r, "confidence"));
  put(out, "source", strAttr(r, "source"));
  put(out, "ref", strAttr(r, "ref"));
  put(out, "action", strAttr(r, "action"));
  return out;
}

function convertExperiment(e: ElementNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, "id", strAttr(e, "id"));
  put(out, "status", strAttr(e, "status"));
  put(out, "created-at", strAttr(e, "created-at"));
  put(out, "updated-at", strAttr(e, "updated-at"));
  put(out, "hypothesis", childText(e, "hypothesis"));
  put(out, "approach", childText(e, "approach"));
  const observations = e.children
    .filter((c) => c.tagName === "observation")
    .map((o) => {
      const obs: Record<string, unknown> = { text: text(o) };
      put(obs, "ref", strAttr(o, "ref"));
      put(obs, "date", strAttr(o, "date"));
      return obs;
    });
  if (observations.length > 0) out.observations = observations;
  put(out, "conclusion", childText(e, "conclusion"));
  return out;
}

await runMigration({
  description: "Convert *.guide.card XML body → frontmatter (pure YAML).",
  match: (name) => name.endsWith(".guide.card"),
  convert: async (absPath, { warnings, apply }) => {
    const content = await readFile(absPath, "utf-8");
    const split = splitCardContent(content);
    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
    if (split.hasFrontmatter && !isXml) return "already";

    const root = await parseCard(content, { source: absPath });
    if (root.tagName !== "guide") {
      throw new Error(`expected <guide> root, got <${root.tagName}>`);
    }
    checkElement({ node: root, source: absPath, spec: SPEC, warnings });

    const fields: Record<string, unknown> = { version: strAttr(root, "version") ?? "1.0.0" };
    const jobTypes = strAttr(root, "job-types");
    if (jobTypes !== undefined) fields["job-types"] = jobTypes.split(/\s+/).filter(Boolean);
    put(fields, "applies-to", childText(root, "applies-to"));

    const triage = child(root, "triage");
    if (triage) {
      const rules = triage.children.filter((c) => c.tagName === "rule").map(convertRule);
      if (rules.length > 0) fields["triage-rules"] = rules;
      const da = child(triage, "default-action");
      if (da) {
        const out: Record<string, unknown> = {};
        put(out, "action", strAttr(da, "action"));
        if (text(da) !== "") out.text = text(da);
        fields["default-action"] = out;
      }
    }

    const actionsEl = child(root, "actions");
    if (actionsEl) {
      const actions = actionsEl.children
        .filter((c) => c.tagName === "action")
        .map((a) => {
          const out: Record<string, unknown> = {};
          put(out, "name", strAttr(a, "name"));
          put(out, "when", childText(a, "when"));
          put(out, "instructions", childText(a, "instructions"));
          return out;
        });
      if (actions.length > 0) fields.actions = actions;
    }

    const experimentsEl = child(root, "experiments");
    if (experimentsEl) {
      const experiments = experimentsEl.children.filter((c) => c.tagName === "experiment").map(convertExperiment);
      if (experiments.length > 0) fields.experiments = experiments;
    }

    const reactionsEl = child(root, "reactions");
    if (reactionsEl) {
      const reactions = reactionsEl.children
        .filter((c) => c.tagName === "reaction")
        .map((r) => {
          const out: Record<string, unknown> = { text: text(r) };
          put(out, "id", strAttr(r, "id"));
          put(out, "sentiment", strAttr(r, "sentiment"));
          return out;
        });
      if (reactions.length > 0) fields.reactions = reactions;
    }

    const contextNotesEl = child(root, "context-notes");
    if (contextNotesEl) {
      const notes = contextNotesEl.children
        .filter((c) => c.tagName === "context")
        .map((c) => {
          const out: Record<string, unknown> = { text: text(c) };
          put(out, "duration", strAttr(c, "duration"));
          put(out, "added-at", strAttr(c, "added-at"));
          return out;
        });
      if (notes.length > 0) fields["context-notes"] = notes;
    }

    const out = `---\n${stringifyYaml(fields)}---\n`;
    if (apply) await writeFile(absPath, out, "utf-8");
    return "converted";
  },
});
