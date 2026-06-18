#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Migrate `.procedure.card` definition files from the XML body format to
 * Phase-2 frontmatter (pure YAML, no body).
 *
 * Each phase (precheck/run/validate) groups its children by kind into
 * `shells` / `agents` / `instructions` / `whys` lists — matching how the
 * engine already consumes them. Multi-line shell scripts and agent prompts
 * become YAML block scalars.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/procedure.ts <root>           # dry-run
 *   pnpm exec tsx scripts/migrate/procedure.ts <root> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseCard, splitCardContent, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { dedent } from "../../src/core/procedure/dedent.js";
import { runMigration } from "./_harness.js";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const PHASE: ElementSpec = {
  attrs: [],
  children: {
    shell: { attrs: [] },
    agent: { attrs: ["model", "max-turns"] },
    instruction: { attrs: [] },
    why: { attrs: [] },
  },
};

const SPEC: ElementSpec = {
  attrs: ["name", "run-expiry", "failed-run-expiry"],
  children: {
    description: { attrs: [] },
    step: {
      attrs: ["id"],
      children: {
        description: { attrs: [] },
        precheck: { attrs: ["pass-output"], children: PHASE.children },
        run: { attrs: [], children: PHASE.children },
        validate: { attrs: ["severity"], children: PHASE.children },
      },
    },
  },
};

function dtext(el: ElementNode): string {
  return dedent(typeof el.text === "string" ? el.text : "");
}

function child(el: ElementNode, tag: string): ElementNode | undefined {
  return el.children.find((c) => c.tagName === tag);
}

function convertPhase(phase: ElementNode): Record<string, unknown> {
  const shells: string[] = [];
  const agents: Record<string, unknown>[] = [];
  const instructions: string[] = [];
  const whys: string[] = [];
  for (const c of phase.children) {
    if (c.tagName === "shell") shells.push(dtext(c));
    else if (c.tagName === "instruction") instructions.push(dtext(c));
    else if (c.tagName === "why") whys.push(dtext(c));
    else if (c.tagName === "agent") {
      const agent: Record<string, unknown> = { prompt: dtext(c) };
      const model = c.attrs["model"];
      if (typeof model === "string" && model !== "") agent.model = model;
      const maxTurns = c.attrs["max-turns"];
      if (typeof maxTurns === "string" && maxTurns !== "") agent["max-turns"] = Number(maxTurns);
      agents.push(agent);
    }
  }
  const out: Record<string, unknown> = {};
  if (shells.length > 0) out.shells = shells;
  if (agents.length > 0) out.agents = agents;
  if (instructions.length > 0) out.instructions = instructions;
  if (whys.length > 0) out.whys = whys;
  return out;
}

function convertStep(step: ElementNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: step.attrs["id"] ?? "unknown" };
  const desc = child(step, "description");
  if (desc && dtext(desc) !== "") out.description = dtext(desc);

  const precheck = child(step, "precheck");
  if (precheck) {
    const p = convertPhase(precheck);
    // pass-output belongs on the precheck. Some templates misplaced it on a
    // child <shell> (where the engine ignored it) — honor the clear intent
    // by hoisting it up.
    const onPrecheck = precheck.attrs["pass-output"] === "true";
    const onShell = precheck.children.some(
      (c) => c.tagName === "shell" && c.attrs["pass-output"] === "true",
    );
    if (onPrecheck || onShell) p["pass-output"] = true;
    out.precheck = p;
  }
  const run = child(step, "run");
  if (run) out.run = convertPhase(run);
  const validate = child(step, "validate");
  if (validate) {
    const v = convertPhase(validate);
    const severity = validate.attrs["severity"];
    if (typeof severity === "string" && severity !== "" && severity !== "warn") v.severity = severity;
    out.validate = v;
  }
  return out;
}

await runMigration({
  description: "Convert *.procedure.card XML body → frontmatter (pure YAML).",
  match: (name) => name.endsWith(".procedure.card"),
  convert: async (absPath, { warnings, apply }) => {
    const content = await readFile(absPath, "utf-8");
    const split = splitCardContent(content);
    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
    if (split.hasFrontmatter && !isXml) return "already";

    const root = await parseCard(content, { source: absPath });
    if (root.tagName !== "procedure") {
      throw new Error(`expected <procedure> root, got <${root.tagName}>`);
    }
    checkElement({ node: root, source: absPath, spec: SPEC, warnings });

    const fields: Record<string, unknown> = { name: root.attrs["name"] ?? "unknown" };
    const desc = child(root, "description");
    if (desc && dtext(desc) !== "") fields.description = dtext(desc);
    const runExpiry = root.attrs["run-expiry"];
    if (typeof runExpiry === "string" && runExpiry !== "") fields["run-expiry"] = runExpiry;
    const failedExpiry = root.attrs["failed-run-expiry"];
    if (typeof failedExpiry === "string" && failedExpiry !== "") fields["failed-run-expiry"] = failedExpiry;
    fields.steps = root.children.filter((c) => c.tagName === "step").map(convertStep);

    const out = `---\n${stringifyYaml(fields)}---\n`;
    if (apply) await writeFile(absPath, out, "utf-8");
    return "converted";
  },
});
