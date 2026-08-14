import type { QuotaWindow } from "../types.js";

export function relativeTime(value: string, now?: Date): string {
  const reference = now ?? new Date();
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const seconds = Math.round((time - reference.getTime()) / 1000);
  if (Math.abs(seconds) < 60) return "just now";
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3600], ["minute", 60]];
  const [unit, size] = units.find((entry) => Math.abs(seconds) >= entry[1]) ?? ["minute", 60];
  return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(Math.round(seconds / size), unit);
}

export function friendlyTimestamp(value: string, now?: Date): string {
  const reference = now ?? new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${relativeTime(value, reference)} · ${new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)}`;
}

export function quotaPace(window: QuotaWindow, now?: Date): { expected: number; difference: number; onTrack: boolean; earlyMs?: number } | null {
  const reference = now ?? new Date();
  if (window.durationMinutes === null) return null;
  const reset = new Date(window.resetsAt).getTime();
  const start = reset - window.durationMinutes * 60_000;
  const expected = Math.max(0, Math.min(100, ((reference.getTime() - start) / (reset - start)) * 100));
  const difference = window.usedPercent - expected;
  const exhaustion = window.usedPercent > 0 ? start + ((reference.getTime() - start) * 100) / window.usedPercent : null;
  return { expected, difference, onTrack: difference <= 0, ...(exhaustion !== null && exhaustion > reference.getTime() && exhaustion < reset ? { earlyMs: reset - exhaustion } : {}) };
}

export function compactDuration(milliseconds: number): string {
  const hours = Math.max(0, Math.round(milliseconds / 3_600_000));
  if (hours < 2) { const minutes = Math.max(1, Math.round(milliseconds / 60_000)); return `${minutes} minute${minutes === 1 ? "" : "s"}`; }
  const days = Math.floor(hours / 24);
  return days ? `${days} day${days === 1 ? "" : "s"}${hours % 24 ? ` ${hours % 24} hours` : ""}` : `${hours} hours`;
}
