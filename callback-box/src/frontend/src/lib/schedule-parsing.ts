/**
 * Parse <schedule> tags from assistant chat messages for UI display.
 * Mirrors the backend parsing in core/chat-schedules.ts.
 */

import { parseTags } from "./parseTags";

export interface ScheduleInfo {
  label: string;
  inRaw: string;
  alarm: boolean;
  announce: string | null;
  content: string;
}

/**
 * Parse <schedule> tags from assistant content.
 */
export function parseScheduleTags(content: string): ScheduleInfo[] {
  const tags = parseTags(content, ["schedule"]);
  const results: ScheduleInfo[] = [];

  for (const tag of tags) {
    if (tag.type !== "schedule") continue;
    const inAttr = tag.attrs.in;
    if (!inAttr) continue;

    results.push({
      label: tag.attrs.label || "timer",
      inRaw: inAttr,
      alarm: tag.attrs.alarm === "1",
      announce: tag.attrs.announce || null,
      content: tag.content.trim(),
    });
  }

  return results;
}

/**
 * Parse a duration string like "5m", "1h", "20s" into milliseconds.
 */
export function parseDurationMs(str: string): number | null {
  const match = str.match(/^(\d+\.?\d*)\s*([dhms])$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2];
  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}
