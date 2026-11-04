/**
 * The limits on `docs/box/agent-changes.md`, the box agent's changelog. A
 * scheduled curator lands entries with no human reading them first, so these
 * limits are what keep the doc short. Nothing here reads the clock: an old
 * checkout cannot start failing with age. Plan: docs/implemented-plans/agent-changes.md.
 */

const MAX_WORDS = 30;
const MAX_ENTRIES = 40;
const SPAN_DAYS = 10;
const MAX_IN_SPAN = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const ENTRY_LINE = /^- (\d{4}-\d{2}-\d{2}) \([\da-f]{7,40}\): (\S.*)$/;
const ENTRY_LIKE = /^(?:-(?!--)|\*|\d{4}-\d{2}-\d{2})/;
const HANDLE = /\*\*([A-Z][A-Z_]+)\*\*/g;

interface Entry {
  line: number;
  date: string;
  time: number;
}

function realDate(date: string): number | null {
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date) return null;
  return time;
}

function textProblems(params: { line: number; text: string; handles: ReadonlySet<string> }): string[] {
  const { line, text, handles } = params;
  const problems: string[] = [];
  const words = text.split(/\s+/).length;
  if (words > MAX_WORDS) problems.push(`line ${String(line)} has ${String(words)} words; the limit is ${String(MAX_WORDS)}`);
  for (const [, handle] of text.matchAll(HANDLE)) {
    if (handle !== undefined && !handles.has(handle)) problems.push(`line ${String(line)} names **${handle}**, which is not a guide section`);
  }
  return problems;
}

function spanProblems(entries: readonly Entry[]): string[] {
  return entries.flatMap((newest, i) => {
    const inSpan = entries.slice(i).filter((e) => newest.time - e.time <= SPAN_DAYS * DAY_MS);
    return inSpan.length > MAX_IN_SPAN
      ? [`${String(inSpan.length)} entries in the ${String(SPAN_DAYS)} days up to ${newest.date}; the limit is ${String(MAX_IN_SPAN)}`]
      : [];
  });
}

/** Every way the doc breaks a limit, one message each; empty when it is within them. */
export function agentChangesProblems(params: { text: string; handles: ReadonlySet<string> }): string[] {
  const { text, handles } = params;
  const problems: string[] = [];
  const entries: Entry[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    if (!ENTRY_LIKE.test(raw)) continue;
    const line = index + 1;
    const match = ENTRY_LINE.exec(raw);
    const date = match?.[1];
    const time = date === undefined ? null : realDate(date);
    if (match === null || date === undefined || time === null) {
      problems.push(`line ${String(line)} is not "- YYYY-MM-DD (hash): text"`);
      continue;
    }
    problems.push(...textProblems({ line, text: match[2] ?? "", handles }));
    const previous = entries.at(-1);
    if (previous !== undefined && time > previous.time) problems.push(`line ${String(line)} is out of order; entries are newest first`);
    entries.push({ line, date, time });
  }
  if (entries.length > MAX_ENTRIES) problems.push(`${String(entries.length)} entries; the limit is ${String(MAX_ENTRIES)}`);
  return [...problems, ...spanProblems(entries.toSorted((a, b) => b.time - a.time))];
}
