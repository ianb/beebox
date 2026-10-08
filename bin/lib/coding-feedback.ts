/**
 * CODING_FEEDBACK entries: the pure parts behind `bin/coding-feedback.ts`.
 *
 * An entry is a short retrospective note an agent writes at a fixed
 * checkpoint. It is stored outside git beside the workstream's exhibits at
 * `<exhibits store>/<workstream>/coding-feedback/<YYYYMMDDTHHMMSSZ>-<checkpoint>.md`:
 * YAML frontmatter (`entryMetaSchema`), then the note body verbatim. Only a
 * retrospective scan reads entries; the boxholder does not.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const CHECKPOINTS = ["plan-reviewed", "implemented", "review-adjudicated", "landed"] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

export const ENGINES = ["claude", "codex"] as const;
export type Engine = (typeof ENGINES)[number];

/** The store subdirectory, a sibling of the workstream's exhibit directories. */
export const FEEDBACK_DIR = "coding-feedback";

export const PROMPTS = [
  "1. What took longer or more tries than it should have, and why.",
  "2. What guidance, doc, or tool was wrong, missing, or in the way.",
  "3. What change to a tracked file would stop the next session hitting it.",
  "4. What change to the codebase itself (a seam, a refactor, a tool) would have made this easier; reported, not proposed as work.",
] as const;

/**
 * How the session was attached. `env`: the harness exported its session id.
 * `mtime`: the newest transcript whose recorded cwd is this checkout, a
 * guess `resolvedAt` lets a later scan check. `flag`: given explicitly.
 * `none`: no transcript found; the note is still kept.
 */
const RESOLVED_BY = ["env", "mtime", "flag", "none"] as const;

const isoSchema = z.iso.datetime();

export const sessionSchema = z.object({
  engine: z.enum(ENGINES).nullable(),
  sessionId: z.string().min(1).nullable(),
  transcriptPath: z.string().min(1).nullable(),
  resolvedBy: z.enum(RESOLVED_BY),
  resolvedAt: isoSchema,
});
export type SessionAttachment = z.infer<typeof sessionSchema>;

const entryMetaSchema = z.object({
  timestamp: isoSchema,
  workstream: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  checkpoint: z.enum(CHECKPOINTS),
  head: z.string().regex(/^[0-9a-f]{40,64}$/u),
  branch: z.string().min(1),
  dirty: z.boolean(),
  ...sessionSchema.shape,
});
export type EntryMeta = z.infer<typeof entryMetaSchema>;

const CHECKPOINT_SET: ReadonlySet<string> = new Set(CHECKPOINTS);
const ENGINE_SET: ReadonlySet<string> = new Set(ENGINES);

export function isCheckpoint(value: string): value is Checkpoint {
  return CHECKPOINT_SET.has(value);
}

export function isEngine(value: string): value is Engine {
  return ENGINE_SET.has(value);
}

/** `20261007T193012Z` — the sortable, filename-safe form of an instant. */
function compactStamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z").replaceAll(/[-:]/gu, "");
}

/** `<stamp>-<checkpoint>.md`, with `-<n>` before `.md` when a same-second entry exists. */
export function entryFileName(input: { date: Date; checkpoint: Checkpoint; attempt: number }): string {
  const suffix = input.attempt > 1 ? `-${input.attempt}` : "";
  return `${compactStamp(input.date)}-${input.checkpoint}${suffix}.md`;
}

/** Normalize a note body; null when nothing but whitespace arrived. */
export function normalizeBody(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : `${trimmed}\n`;
}

export function formatEntry(meta: EntryMeta, body: string): string {
  const checked = entryMetaSchema.parse(meta);
  return `---\n${stringifyYaml(checked, { lineWidth: 0 })}---\n\n${body}`;
}

export type ParsedEntry = { ok: true; meta: EntryMeta; body: string } | { ok: false; problem: string };

export function parseEntry(text: string): ParsedEntry {
  const match = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/u.exec(text);
  if (!match) return { ok: false, problem: "no YAML frontmatter" };
  let raw: unknown;
  try {
    raw = parseYaml(match[1] ?? "");
  } catch (error) {
    if (error instanceof Error) return { ok: false, problem: `frontmatter is not YAML: ${error.message}` };
    throw error;
  }
  const meta = entryMetaSchema.safeParse(raw);
  if (!meta.success) return { ok: false, problem: meta.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, meta: meta.data, body: match[2] ?? "" };
}

export interface ListedEntry {
  path: string;
  timestamp: string;
  workstream: string;
  checkpoint: Checkpoint;
  engine: Engine | null;
  sessionId: string | null;
}

/** Newest first; ties broken by path so the order is stable. */
export function newestFirst(entries: ListedEntry[]): ListedEntry[] {
  return entries.toSorted((a, b) => b.timestamp.localeCompare(a.timestamp) || b.path.localeCompare(a.path));
}

export function formatListLine(entry: ListedEntry): string {
  const session = entry.engine && entry.sessionId ? `${entry.engine}:${entry.sessionId}` : "no-session";
  return `${entry.timestamp}  ${entry.workstream}  ${entry.checkpoint}  ${session}  ${entry.path}`;
}
