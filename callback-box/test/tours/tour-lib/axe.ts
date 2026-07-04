/**
 * axe-core integration: inject the bundle once per page-load, then run
 * the analysis at each checkpoint. We pipe the bundle through stdin so
 * we don't hit OS argv limits — the source is ~600 KB.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { BrowseSession } from "./browse.js";
import type { AxeViolation } from "./types.js";

const require = createRequire(import.meta.url);

let axeSourcePromise: Promise<string> | null = null;
function loadAxeSource(): Promise<string> {
  if (axeSourcePromise === null) {
    const axePath = require.resolve("axe-core/axe.min.js");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is resolved from a static package name
    axeSourcePromise = readFile(axePath, "utf8");
  }
  return axeSourcePromise;
}

// Rules we don't want axe to check on every tour run. Listed here rather
// than filtered after-the-fact so the violations don't even land in the
// .axe.json reports — keeps artifacts focused on what we're actually
// triaging right now. See issues/2026-05-28-color-contrast-wcag-aa-audit.md
// for context on each suppression. Remove an entry to re-enable that rule.
const SUPPRESS_RULES: readonly string[] = [
  // Systemic palette issue across the warm-* scale + semantic -dark
  // variants. Deferred — see issues/2026-05-28-color-contrast-wcag-aa-audit.md.
  "color-contrast",
];

const RUN_SCRIPT = `(async () => {
  const r = await window.axe.run(document, {
    resultTypes: ["violations"],
    reporter: "v2",
    rules: ${JSON.stringify(Object.fromEntries(SUPPRESS_RULES.map((r) => [r, { enabled: false }])))},
  });
  return r.violations.map(v => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.map(n => ({
      target: n.target,
      html: n.html,
      failureSummary: n.failureSummary,
    })),
  }));
})()`;

/**
 * Inject axe into a session's current page and return violations. Safe
 * to call multiple times — if axe is already loaded, the injection is a
 * no-op assignment.
 */
export async function runAxe(session: BrowseSession): Promise<AxeViolation[]> {
  const axeSource = await loadAxeSource();
  // Inject by piping the bundle as a single script. axe-core's UMD assigns
  // window.axe when run in a browser; once it's there, re-running this is
  // harmless (it just redefines the same global).
  await session.evalStdin(axeSource);
  const raw = await session.eval(RUN_SCRIPT);
  return parseAxeOutput(raw);
}

function parseAxeOutput(raw: string): AxeViolation[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "[]") return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed as AxeViolation[];
  } catch {
    return [];
  }
}
