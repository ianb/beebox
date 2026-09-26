/**
 * `bbx judge`'s states: what is judged, read from stdin (or `--replay`).
 * Without `--per-line` the whole text is one state; with it, each non-empty
 * line is one. With `--cards` a line is a card path and the state is the card
 * text, its body capped at 4,000 characters; a `--cards` batch (no
 * `--per-line`) is every card after a `=== <path>` line, like `bbx changes
 * --cat`, and is refused over `--max-batch` items. See
 * docs/plans/notifications.md (Track D).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { splitCardContent } from "../../cards/index.js";
import { errnoCode } from "../../lib/error-guards.js";
import { resolveRefPath } from "../../shared/ref-path.js";

/** The trial's 400 was too short to judge on (2026-09-26). */
export const CARD_BODY_CAP = 4000;

export const DEFAULT_MAX_BATCH = 20;

/** Below this a state is probably a subject line, not the body; the judge warns. */
export const THIN_STATE_CHARS = 300;

export interface JudgedState {
  /** What `--select` prints and the JSON line carries: the line, the card path, or the whole text. */
  input: string;
  state: string;
}

export type ReadStates = { ok: true; states: JudgedState[] } | { ok: false; error: string };

/** A card's text with its body cut at {@link CARD_BODY_CAP}, or null when the file is gone. */
async function cardState(boxRoot: string, cardPath: string): Promise<string | null> {
  const resolved = resolveRefPath({ fromPath: undefined, ref: cardPath, kind: "write-target" });
  if (resolved === null) return null;
  let text: string;
  try {
    text = await fs.readFile(path.join(boxRoot, resolved), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "EISDIR") return null;
    throw e;
  }
  const split = splitCardContent(text);
  if (split.body.length <= CARD_BODY_CAP) return text.replace(/\n$/, "");
  const body = `${split.body.slice(0, CARD_BODY_CAP)}\n… (body cut at ${String(CARD_BODY_CAP)} of ${String(split.body.length)} characters)`;
  return text.slice(0, text.length - split.body.length) + body;
}

async function readCards(boxRoot: string, lines: string[]): Promise<Array<{ path: string; text: string }>> {
  const cards: Array<{ path: string; text: string }> = [];
  for (const line of lines) {
    const text = await cardState(boxRoot, line);
    if (text === null) {
      console.error(`bbx judge: ${line} is not a card in the box; skipped`);
      continue;
    }
    cards.push({ path: line, text });
  }
  return cards;
}

export async function readStates(
  boxRoot: string,
  opts: { text: string; perLine: boolean; cards: boolean; maxBatch: number },
): Promise<ReadStates> {
  const { text, perLine, cards, maxBatch } = opts;
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (!cards) {
    if (perLine) return { ok: true, states: lines.map((line) => ({ input: line, state: line })) };
    return { ok: true, states: text.trim() === "" ? [] : [{ input: text, state: text }] };
  }
  if (!perLine && lines.length > maxBatch) {
    return {
      ok: false,
      error: `${String(lines.length)} cards is more than --max-batch ${String(maxBatch)}. A batch is only right when the whole says something the items do not; judge each card with --per-line`,
    };
  }
  const read = await readCards(boxRoot, lines);
  if (perLine) return { ok: true, states: read.map((c) => ({ input: c.path, state: c.text })) };
  if (read.length === 0) return { ok: true, states: [] };
  const state = read.map((c) => `=== ${c.path}\n${c.text}`).join("\n");
  return { ok: true, states: [{ input: read.map((c) => c.path).join("\n"), state }] };
}
