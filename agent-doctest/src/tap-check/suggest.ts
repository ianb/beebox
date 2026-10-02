/**
 * Paste-ready expected values and hints for failed check() assertions.
 *
 * Agents fix a failing doctest by pasting the actual value. The suggestion
 * is that value with volatile parts (dates, UUIDs, temp paths, pid,
 * hostname, long hex ids, epoch timestamps) replaced by wildcards, and
 * blank lines written as `«blankline»` so the value survives in a doctest.
 */

import { realpathSync } from "node:fs";
import os from "node:os";
import { alignLines } from "./diff.js";
import { matchExtractions } from "./match.js";

const DAY_MS = 86_400_000;

/**
 * Paste-ready expected value for `actual`, or null when no rewrite matches it
 * (for example, the actual text contains `«`).
 *
 * Lines that already match `expected` keep the expected text, so the
 * author's wildcards survive; other lines are the actual text with volatile
 * parts wildcarded. If that merge does not match as a whole (a multi-line
 * wildcard, say), the wildcarded actual alone is tried.
 */
export function suggestExpected(actual: string, expected?: string): string | null {
  const candidates: string[] = [];
  if (expected !== undefined) {
    const merged = alignLines(actual.split("\n"), expected.split("\n"))
      .filter((op) => op.tag !== "-")
      .map((op) => (op.tag === " " ? op.text : wildcardLine(op.text)));
    candidates.push(merged.map(blankline).join("\n"));
  }
  candidates.push(actual.split("\n").map((line) => blankline(wildcardLine(line))).join("\n"));
  return candidates.find((text) => matchExtractions(actual, text) !== null) ?? null;
}

function blankline(line: string): string {
  return line === "" ? "«blankline»" : line;
}

function wildcardLine(line: string): string {
  let text = line;
  for (const [re, replacement] of replacements()) {
    text = text.replace(re, replacement);
  }
  return text;
}

type Replacement = [RegExp, (m: string) => string];

function replacements(): Replacement[] {
  const now = Date.now();
  const list: Replacement[] = [];
  // Temp paths: the root plus its first (usually random) segment; keep the tail.
  for (const root of tempRoots()) {
    list.push([new RegExp(`(?<![\\w./-])${escape(root)}/[^\\s"'\`,;:)\\]}/]+`, "g"), () => "«*»"]);
  }
  list.push(
    [/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/g, () => "«uuid»"],
    [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?/g, () => "«date»"],
    [/\b\d{4}-\d{2}-\d{2}\b/g, (m) => (nearbyDates(now).has(m) ? "«date»" : m)],
    [/\b(?:\d{10}|\d{13})\b/g, (m) => (isNearEpoch(Number(m), now) ? "«int»" : m)],
    [/\b(?=[\da-f]*\d)(?=[\da-f]*[a-f])[\da-f]{12,}\b/gi, () => "«*»"],
  );
  const pid = String(process.pid);
  if (pid.length >= 3) list.push([new RegExp(`\\b${pid}\\b`, "g"), () => "«int»"]);
  for (const host of hostnames()) {
    list.push([new RegExp(`(?<![\\w.-])${escape(host)}(?![\\w-])`, "g"), () => "«*»"]);
  }
  return list;
}

function tempRoots(): string[] {
  const roots = new Set(["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"]);
  const tmp = os.tmpdir().replace(/\/+$/, "");
  roots.add(tmp);
  try {
    roots.add(realpathSync(tmp));
  } catch {
    // tmpdir missing: the literal roots still apply
  }
  // Longest first, so os.tmpdir() wins over its /var/folders prefix.
  return [...roots].toSorted((a, b) => b.length - a.length);
}

function hostnames(): string[] {
  const full = os.hostname();
  const short = full.split(".")[0] ?? "";
  return [...new Set([full, short])].filter((h) => h.length >= 4 && h !== "localhost");
}

/** Yesterday, today, and tomorrow, in both UTC and local time. */
function nearbyDates(now: number): Set<string> {
  const out = new Set<string>();
  for (const offset of [-DAY_MS, 0, DAY_MS]) {
    const d = new Date(now + offset);
    out.add(d.toISOString().slice(0, 10));
    const pad = (n: number): string => String(n).padStart(2, "0");
    out.add(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return out;
}

/** An epoch timestamp (seconds or milliseconds) within a day of now. */
function isNearEpoch(n: number, now: number): boolean {
  return Math.abs(n - now) < DAY_MS || Math.abs(n * 1000 - now) < DAY_MS;
}

function escape(s: string): string {
  return s.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
}

// ── Hints ────────────────────────────────────────────────────────────────────

/** Hints for common mismatch shapes, or null when none apply. */
export function mismatchHint(actual: string, expected: string): string | null {
  const hints: string[] = [];
  const trimmed = expected.trim();
  const quoted = /^"([\S\s]*)"$|^'([\S\s]*)'$/.exec(trimmed);
  if (quoted && (quoted[1] ?? quoted[2]) === actual) {
    hints.push("strings compare without quotes; drop the quotes");
  }
  if (trimmed === "true" || trimmed === "false") {
    hints.push(
      "a boolean result hides the value; print the value instead, using wildcards («*», «date», «int») for the parts that vary",
    );
  }
  const trimEnds = (s: string): string => s.split("\n").map((l) => l.trimEnd()).join("\n");
  if (actual !== expected && trimEnds(actual) === trimEnds(expected)) {
    hints.push("the values differ only in trailing whitespace");
  }
  return hints.length > 0 ? hints.join("\n") : null;
}
