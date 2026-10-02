/**
 * Render findings for a terminal or an agent reading through a pipe: grouped
 * by rule, then path. `summary` mode counts findings per rule and per
 * top-level directory instead, for a whole-tree report.
 */
import type { Finding, RuleId } from "../../model.js";

function groupBy<K, V>(items: V[], key: (item: V) => K): Map<K, V[]> {
  const groups = new Map<K, V[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list === undefined) groups.set(k, [item]);
    else list.push(item);
  }
  return groups;
}

function byPathThenMessage(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.message === b.message) return 0;
  return a.message < b.message ? -1 : 1;
}

export function renderFindings(findings: Finding[]): string {
  const lines: string[] = [];
  const groups = groupBy<RuleId, Finding>(findings, (f) => f.rule);
  for (const rule of [...groups.keys()].toSorted()) {
    const group = (groups.get(rule) ?? []).toSorted(byPathThenMessage);
    lines.push(`${rule} (${group.length})`);
    for (const f of group) lines.push(`  ${f.path}: ${f.message}`);
  }
  return lines.join("\n");
}

/** Top two path segments below the package root: `beebox/src/core`. */
function areaOf(params: { path: string; root: string }): string {
  const rest = params.path.slice(params.root.length + 1).split("/");
  return [params.root, ...rest.slice(0, 2)].join("/");
}

export function renderSummary(params: { findings: Finding[]; root: string }): string {
  const lines: string[] = [];
  const groups = groupBy<RuleId, Finding>(params.findings, (f) => f.rule);
  for (const rule of [...groups.keys()].toSorted()) {
    const group = groups.get(rule) ?? [];
    lines.push(`${rule} (${group.length})`);
    const areas = groupBy(group, (f) => areaOf({ path: f.path, root: params.root }));
    const ranked = [...areas.entries()].toSorted((a, b) => b[1].length - a[1].length);
    for (const [area, items] of ranked) lines.push(`  ${String(items.length).padStart(4)}  ${area}`);
  }
  return lines.join("\n");
}
