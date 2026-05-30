/**
 * Helpers for `cb scheduler log` — reading, filtering, and rendering
 * scheduler log entries. Extracted from scheduler.ts to keep that file
 * under the line limit and its command actions readable.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import {
  loadSchedulerConfig,
  boxLogFile,
  type LogEntry,
} from "../../core/scheduler.js";

export interface LogFilters {
  errors?: boolean | undefined;
  script?: string | undefined;
}

export async function resolveLogBoxes(boxOption: string | undefined): Promise<string[]> {
  if (boxOption) {
    return [path.resolve(boxOption)];
  }
  const config = await loadSchedulerConfig();
  return config.boxes;
}

function entryMatchesFilters(entry: LogEntry, filters: LogFilters): boolean {
  if (filters.errors) {
    const hasError = Boolean(entry.error) || Boolean(entry.result && entry.result.errors > 0);
    if (!hasError) return false;
  }
  if (filters.script) {
    // Keep only tick entries where this script ran or errored.
    const match = entry.result && entry.result.scripts.some(
      (s) => s.name === filters.script && (s.status === "ran" || s.status === "error"),
    );
    if (!match) return false;
  }
  return true;
}

export async function readBoxEntries(boxPath: string, filters: LogFilters): Promise<LogEntry[]> {
  const logPath = boxLogFile(boxPath);
  try {
    await fs.access(logPath);
  } catch (_e) {
    // No log file for this box yet — expected when a box has never
    // had a scheduler tick. Skip it and move on.
    return [];
  }

  const rl = readline.createInterface({
    input: createReadStream(logPath),
    crlfDelay: Infinity,
  });

  const entries: LogEntry[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (entryMatchesFilters(entry, filters)) {
        entries.push(entry);
      }
    } catch (e) {
      // Skip malformed JSONL lines, but surface them — a corrupt
      // line shouldn't abort the whole log read silently.
      console.warn(`Skipping malformed log line in ${logPath}:`, e);
    }
  }
  return entries;
}

function formatTimestamp(ts: string): string {
  return ts.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function renderScriptFilteredEntry(entry: LogEntry, script: string): void {
  if (entry.event !== "tick" || !entry.result) return;
  const ts = formatTimestamp(entry.ts);
  const boxName = path.basename(entry.box ?? "?");
  const ranScripts = entry.result.scripts.filter((s) => s.status === "ran" && s.name === script);
  const errorScripts = entry.result.scripts.filter((s) => s.status === "error" && s.name === script);
  for (const s of ranScripts) {
    const dur = s.durationMs ? ` (${(s.durationMs / 1000).toFixed(1)}s)` : "";
    console.log(`${ts}  ${boxName}: → ${s.name}${dur}`);
  }
  for (const s of errorScripts) {
    console.log(`${ts}  ${boxName}: ✗ ${s.name}: ${s.error ?? "unknown error"}`);
  }
}

function renderTickResult(entry: LogEntry): void {
  if (entry.event !== "tick" || !entry.result) return;
  const ts = formatTimestamp(entry.ts);
  const boxName = path.basename(entry.box ?? "?");
  const r = entry.result;
  if (r.ran === 0 && r.errors === 0) {
    console.log(`${ts}  ${boxName}: all ${r.skipped} skipped`);
    return;
  }
  console.log(`${ts}  ${boxName}: ${r.ran} ran, ${r.skipped} skipped, ${r.errors} errors`);
  for (const s of r.scripts.filter((script) => script.status === "ran")) {
    const dur = s.durationMs ? ` (${(s.durationMs / 1000).toFixed(1)}s)` : "";
    console.log(`  → ${s.name}${dur}`);
  }
  for (const s of r.scripts.filter((script) => script.status === "error")) {
    console.log(`  ✗ ${s.name}: ${s.error ?? "unknown error"}`);
  }
}

export function renderLogEntry(entry: LogEntry, script: string | undefined): void {
  if (entry.event !== "tick") return;
  if (entry.result) {
    // When filtering to a single script, render just that script's line
    // with timestamp + box context — suppress the tick summary header.
    if (script) {
      renderScriptFilteredEntry(entry, script);
    } else {
      renderTickResult(entry);
    }
  } else if (entry.error) {
    const ts = formatTimestamp(entry.ts);
    const boxName = path.basename(entry.box ?? "?");
    console.log(`${ts}  ${boxName}: ERROR ${entry.error}`);
  }
}
