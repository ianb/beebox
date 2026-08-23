/**
 * The dump: one client's {@link UiScanPayload} rendered as the text `cb chat ui`
 * prints for the agent.
 *
 * Pure — it takes the payload and returns the string, so the format is a
 * doctest rather than something you have to run a browser to see. The shape is
 * fixed by `docs/plans/agent-points-at-ui.md` (Track 3, "The dump format"): a
 * header naming the surface, the URL and the scan time; what the scan could
 * and could not see; how much it left out; the controls grouped by the landmark
 * they sit in, each presented as the link the agent should write back
 * (memory-atlas's idea, copied deliberately); and a closing paragraph telling
 * the agent how to use them.
 *
 * Every omission is stated. A short list presented as a complete one is the
 * failure this feature exists to avoid, so the counts, the duplicate addresses
 * and the truncation flag are all printed when they are non-zero.
 */

import type { UiScanEntry, UiScanPayload } from "../../shared/ui-scan.js";
import { assertNever } from "../../lib/invariant.js";

/** Column the `(no address)` marker is padded out to, so the addressless read as a column. */
const NO_ADDRESS_COLUMN = 56;
/** Wrap width for a `— does` description. */
const DOES_WIDTH = 74;
/** Suffix Track 4a gave the mobile-breakpoint copy of a duplicated control. */
const MOBILE_SUFFIX = "-mobile";

/** `2026-08-23T14:32:07.000Z` → `14:32`, in whatever timezone this process runs in. */
function localHourMinute(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown time";
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** What the scan reached, and — when it fell short — which controls are missing. */
function coverageLine(payload: UiScanPayload): string {
  switch (payload.coverage) {
    case "dom":
      return "Covers: browser DOM only. This surface has no native chrome.";
    case "dom+native":
      return "Covers: browser DOM and the native app's own controls.";
    case "dom-native-unavailable":
      return (
        "Covers: browser DOM only — the native app did not answer. The composer, " +
        "the mic, capture and the box switcher are native controls on this surface " +
        "and are missing from this list; describe them in words rather than pointing at them."
      );
    default:
      assertNever(payload.coverage);
  }
}

/** `1 control` / `3 controls` — a count the agent reads as a sentence. */
function plural(count: number, noun: string): string {
  return count === 1 ? `${count} ${noun}` : `${count} ${noun}s`;
}

/** The counted omissions, one line each, printed only when non-zero. */
function omissionLines(payload: UiScanPayload): string[] {
  const lines: string[] = [];
  if (payload.omittedUnnamed > 0) {
    lines.push(`${plural(payload.omittedUnnamed, "control")} omitted: no accessible name.`);
  }
  if (payload.omittedUnknownRole > 0) {
    lines.push(`${plural(payload.omittedUnknownRole, "element")} omitted: role not one this scan reports.`);
  }
  if (payload.truncated) {
    lines.push("List truncated: there is more chrome on screen than is shown below.");
  }
  if (payload.duplicateIds.length > 0) {
    lines.push(
      `Duplicate addresses — ${payload.duplicateIds.join(", ")} — each appears on more than ` +
        "one element, so a pointer to it may reach the wrong one."
    );
  }
  return lines;
}

/** Wrap `text` to {@link DOES_WIDTH}, indenting continuation lines. */
function wrap(text: string, { indent, continuation }: { indent: string; continuation: string }): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let current = indent;
  let prefixLength = indent.length;
  for (const word of words) {
    if (current.length > prefixLength && current.length + 1 + word.length > DOES_WIDTH) {
      lines.push(current);
      current = continuation + word;
      prefixLength = continuation.length;
    } else {
      current = current.length > prefixLength ? `${current} ${word}` : current + word;
    }
  }
  if (current.trim() !== "") lines.push(current);
  return lines;
}

/** The `role [name](control:id)` / `role "name" (no address)` line for one entry. */
function entryLine(entry: UiScanEntry, indent: string): string {
  const marks = [
    entry.actions.includes("reveal") ? "[reveal]" : "",
    entry.disabled ? "[disabled]" : "",
    entry.offscreen ? "(off-screen)" : "",
  ].filter((mark) => mark !== "");
  if (entry.id === null) {
    const head = `${indent}${entry.role} "${entry.name}"`;
    const padded = head.padEnd(NO_ADDRESS_COLUMN, " ");
    return [`${padded} (no address)`, ...marks].join(" ").trimEnd();
  }
  return [`${indent}${entry.role} [${entry.name}](control:${entry.id})`, ...marks].join(" ");
}

/** One entry: its line, plus its wrapped `— does` description when it has one. */
function entryBlock(entry: UiScanEntry, indent: string): string[] {
  const lines = [entryLine(entry, indent)];
  if (entry.does !== null) {
    lines.push(...wrap(entry.does, { indent: `${indent}  — `, continuation: `${indent}    ` }));
  }
  return lines;
}

/**
 * The controls, grouped under the landmark each sits in. A group's heading is
 * the landmark's own entry, printed in the tours' `role "name"` idiom; every
 * entry naming that landmark as its container follows, indented. Grouping is
 * one level deep on purpose — a nested landmark heads its own group rather than
 * indenting further, so the columns stay readable at any nesting depth.
 */
function entryLines(entries: readonly UiScanEntry[]): string[] {
  const containerNames = new Set(
    entries.map((entry) => entry.container).filter((name): name is string => name !== null)
  );
  const lines: string[] = [];
  for (const entry of entries) {
    const isHeading = containerNames.has(entry.name) && entry.container !== entry.name;
    if (isHeading) {
      lines.push(`${entry.role} "${entry.name}"`);
      if (entry.does !== null) lines.push(...wrap(entry.does, { indent: "  — ", continuation: "    " }));
      continue;
    }
    lines.push(...entryBlock(entry, entry.container === null ? "" : "  "));
  }
  return lines;
}

/**
 * Which of a breakpoint-duplicated pair the user can actually reach.
 *
 * Track 4a gave the mobile composer row its own ids (`…-mobile`) because the
 * two rows could not be unified. Both can be listed at once (one is usually
 * hidden and therefore absent, but a wide-enough phone or a transitional layout
 * can show both), so when both appear the dump says which one to point at
 * rather than leaving the agent to guess.
 */
function breakpointNotes(payload: UiScanPayload): string[] {
  const listed = new Map<string, UiScanEntry>();
  for (const entry of payload.entries) {
    if (entry.id !== null) listed.set(entry.id, entry);
  }
  const notes: string[] = [];
  for (const [id, entry] of listed) {
    if (!id.endsWith(MOBILE_SUFFIX)) continue;
    const baseId = id.slice(0, -MOBILE_SUFFIX.length);
    const base = listed.get(baseId);
    if (base === undefined) continue;
    const reachable = pickReachable({ base, mobile: entry, channel: payload.channel })
      ? id
      : baseId;
    notes.push(
      wrap(
        `Note: ${baseId} and ${id} are the same control at two breakpoints. ` +
          `At this viewport ${reachable} is the one the user can reach.`,
        { indent: "", continuation: "" }
      ).join("\n")
    );
  }
  return notes;
}

/** True when the mobile-breakpoint copy is the reachable one. */
function pickReachable(opts: {
  base: UiScanEntry;
  mobile: UiScanEntry;
  channel: UiScanPayload["channel"];
}): boolean {
  const { base, mobile, channel } = opts;
  // On screen beats off screen; if both are on screen, the channel decides
  // which row the layout is showing.
  if (base.offscreen !== mobile.offscreen) return base.offscreen;
  return channel !== "web-desktop";
}

/**
 * The closing instruction, verbatim from the plan. It teaches the one thing the
 * list alone cannot: that an entry is a link the agent writes back, and that a
 * control without an address is described in words rather than invented.
 */
const INSTRUCTION = `To point the user at one of these, write its link into your reply:
[the mic](control:cb-composer-mic?action=point&description=tap%20and%20talk).
\`action\` is \`point\` (default), \`focus\`, or \`reveal\` — \`reveal\` is available
only on a control marked \`[reveal]\`, and it opens the control; it never acts
for the user. A control shown as \`(no address)\` is on screen but has no link —
describe it in words instead of inventing an address for it.`;

/** Render one scan as the text `cb chat ui` prints. */
export function formatUiDump(payload: UiScanPayload): string {
  // The first line is never wrapped — it is the one line an agent skimming the
  // dump reads whole. Everything after it is prose, and wraps.
  const header = [
    `UI on screen — ${payload.channel}, ${payload.url}, scanned ${localHourMinute(payload.scannedAt)} local`,
    ...[coverageLine(payload), ...omissionLines(payload)].flatMap((line) =>
      wrap(line, { indent: "", continuation: "" })
    ),
  ];
  const body =
    payload.entries.length === 0
      ? ["No controls were found on screen — the page may still be loading."]
      : entryLines(payload.entries);
  const sections = [header.join("\n"), body.join("\n"), ...breakpointNotes(payload), INSTRUCTION];
  return `${sections.join("\n\n")}\n`;
}
