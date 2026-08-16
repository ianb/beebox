import { parseDuration } from "../../schemas/scheduled-script.js";
import { parseAttrs } from "../../shared/parse-attrs.js";

function log(...args: unknown[]): void {
  console.log("[ChatSchedules]", ...args);
}

export interface ParsedScheduleTag {
  label: string;
  alarm: boolean;
  announce: string | null;
  content: string;
  durationMs: number;
}

/** Parse schedule tags from an assistant response. */
export function parseScheduleTags(text: string): ParsedScheduleTag[] {
  const results: ParsedScheduleTag[] = [];
  const regex = /<schedule\s+([^>]*)>([\S\s]*?)<\/schedule>/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const attrs = parseAttrs(match[1] || "");
    if (!attrs.in) {
      log("Skipping <schedule> tag without 'in' attribute");
      continue;
    }
    let durationMs: number;
    try {
      durationMs = parseDuration(attrs.in);
    } catch (error) {
      log(`Invalid duration in <schedule>: ${String(error)}`);
      continue;
    }
    results.push({
      label: attrs.label || "timer",
      alarm: attrs.alarm === "1",
      announce: attrs.announce || null,
      content: (match[2] || "").trim(),
      durationMs,
    });
  }
  return results;
}

/** Parse cancellation tags from an assistant response. */
export function parseCancelScheduleTags(text: string): string[] {
  const labels: string[] = [];
  const regex = /<cancel-schedule\s+([^/>]*)\/?\s*>/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const label = parseAttrs(match[1] || "").label;
    if (label) labels.push(label);
  }
  return labels;
}
