/**
 * Shared helper for migrators to track unrecognized fields.
 *
 * Each migrator declares the attrs/children it knows how to map and runs
 * `checkElement(node, source, spec, warnings)` before conversion. Anything
 * outside the spec accumulates in the warnings list and gets printed at
 * the end of the run.
 *
 * Spec shape:
 *   { attrs: ["a", "b"], children: { tag1: <subSpec or "ignore">, tag2: "ignore" } }
 *
 * "ignore" means "I know this child exists but I don't validate its
 * internals" — useful for children whose internals are arbitrary
 * markdown/text.
 */

import { relative } from "node:path";
import type { ElementNode } from "cardworks";

export interface Warning {
  file: string;
  message: string;
}

export interface ElementSpec {
  attrs: readonly string[];
  children?: Record<string, ElementSpec | "ignore">;
  /** When true, allow any unrecognized children without warning. */
  allowAnyChildren?: boolean;
}

export class WarningCollector {
  readonly warnings: Warning[] = [];

  push(file: string, message: string): void {
    this.warnings.push({ file, message });
  }

  dump(absRoot: string): void {
    if (this.warnings.length === 0) return;
    console.log(`\n${String(this.warnings.length)} warning(s) about unrecognized fields:`);
    for (const w of this.warnings) {
      console.log(`  ${relative(absRoot, w.file)}: ${w.message}`);
    }
  }
}

export interface CheckArgs {
  node: ElementNode;
  source: string;
  spec: ElementSpec;
  warnings: WarningCollector;
  path?: string;
}

export function checkElement(args: CheckArgs): void {
  const { node, source, spec, warnings } = args;
  const path = args.path ?? `<${node.tagName}>`;
  const attrSet = new Set(spec.attrs);
  for (const attr of Object.keys(node.attrs)) {
    if (!attrSet.has(attr)) {
      warnings.push(source, `unknown attr at ${path}: ${attr}="${String(node.attrs[attr])}"`);
    }
  }
  if (spec.allowAnyChildren) return;
  const childSpec = spec.children ?? {};
  for (const child of node.children) {
    const childRule = childSpec[child.tagName];
    if (childRule === undefined) {
      warnings.push(source, `unknown child at ${path}: <${child.tagName}>`);
      continue;
    }
    if (childRule === "ignore") continue;
    checkElement({ node: child, source, spec: childRule, warnings, path: `${path} > <${child.tagName}>` });
  }
}
