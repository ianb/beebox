/**
 * Label audit: controls the box agent cannot tell apart. The agent, `bin/browse`
 * and screen readers know a control by its role, accessible name and nearest
 * named container; two visible controls that match on all three ("Run" on
 * every schedule row, in one unnamed list) are one control as far as any of
 * them can say. The audit reads the app's own scan (`window.__bbxUiScan`,
 * src/frontend/src/lib/ui-scan/window-hook.ts), the same walk the agent's UI
 * dump uses, so a finding here is a confusion the agent has.
 *
 * Missing names are axe's `button-name`/`link-name`/`label` rules and land in
 * the .axe.json report; this audit does not repeat them.
 */

import type { ControlEntry, ScanResult } from "../../../src/frontend/src/lib/ui-scan/types.js";
import type { BrowseSession } from "./browse.js";

export interface AmbiguousControl {
  role: string;
  name: string;
  container: string | null;
  count: number;
}

/** Visible controls sharing a role, name and container, most repeated first. */
export function ambiguousControls(entries: readonly ControlEntry[]): AmbiguousControl[] {
  const groups = new Map<string, AmbiguousControl>();
  for (const entry of entries) {
    if (entry.kind !== "control") continue;
    const key = JSON.stringify([entry.role, entry.name, entry.container]);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { role: entry.role, name: entry.name, container: entry.container, count: 1 });
    else group.count += 1;
  }
  return [...groups.values()].filter((g) => g.count > 1).toSorted((a, b) => b.count - a.count);
}

export function describeAmbiguous(group: AmbiguousControl): string {
  const where = group.container === null ? "with no named container" : `in "${group.container}"`;
  return `${String(group.count)} ${group.role}s named "${group.name}" ${where}`;
}

/** The page's scan, or null on a page outside the app (no hook installed). */
export async function scanPage(session: BrowseSession): Promise<ScanResult | null> {
  // agent-browser prints the returned value as JSON.
  const raw = await session.eval("window.__bbxUiScan ? window.__bbxUiScan() : null");
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: the page's own scan built this value from the ScanResult type
  return JSON.parse(raw.trim()) as ScanResult | null;
}
