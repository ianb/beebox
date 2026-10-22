import { parseDuration } from "../../../schemas/scheduled-script/schema.js";
import { parseAttrs } from "../../../shared/parse-attrs.js";
import { errorMessage } from "../../../shared/error-guards.js";

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

/**
 * Parse schedule tags from an assistant response. A tag that cannot be read
 * is skipped and reported through `onRejected` (label and reason).
 */
export function parseScheduleTags(text: string, options?: { onRejected?: (label: string, reason: string) => void }): ParsedScheduleTag[] {
  const reject = (label: string, reason: string): void => {
    log(`Skipping <schedule label="${label}">: ${reason}`);
    options?.onRejected?.(label, reason);
  };
  const results: ParsedScheduleTag[] = [];
  const regex = /<schedule\s+([^>]*)>([\S\s]*?)<\/schedule>/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const attrs = parseAttrs(match[1] || "");
    const label = attrs.label || "timer";
    if (!attrs.in) {
      reject(label, "it has no in= attribute");
      continue;
    }
    let durationMs: number;
    try {
      durationMs = parseDuration(attrs.in);
    } catch (error) {
      reject(label, `in="${attrs.in}" is not a duration (${errorMessage(error)})`);
      continue;
    }
    results.push({
      label,
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
