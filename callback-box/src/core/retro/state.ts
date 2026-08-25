/**
 * Retrospective walker state — which sessions have been processed.
 *
 * Persisted at `.callback-box/retro/state.json` (box-local machine state,
 * like the chat registries). A session marked `done` is never re-observed;
 * a `failed` session is retried on later runs until it exhausts
 * {@link MAX_OBSERVE_ATTEMPTS}, after which it is skipped permanently
 * (and reported as such).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../lib/error-guards.js";

const STATE_FILE = ".callback-box/retro/state.json";

/** Observer attempts per session before it is permanently skipped. */
const MAX_OBSERVE_ATTEMPTS = 2;

const RetroSessionStateSchema = z.object({
  status: z.enum(["done", "failed"]),
  attempts: z.number().int(),
  at: z.string(),
});

const RetroStateSchema = z.object({
  lastRunAt: z.string().nullable(),
  sessions: z.record(z.string(), RetroSessionStateSchema),
});

export type RetroSessionState = z.infer<typeof RetroSessionStateSchema>;
export type RetroState = z.infer<typeof RetroStateSchema>;

export function emptyRetroState(): RetroState {
  return { lastRunAt: null, sessions: {} };
}

/**
 * True when state says this session needs no further attention — either
 * observed successfully or permanently failed.
 */
export function isSessionSettled(state: RetroState, sessionId: string): boolean {
  const sessionState = state.sessions[sessionId];
  if (!sessionState) return false;
  if (sessionState.status === "done") return true;
  return sessionState.attempts >= MAX_OBSERVE_ATTEMPTS;
}

/**
 * Load walker state, treating a missing file as a fresh start. A corrupt
 * or schema-mismatched file also starts fresh (with a warning) — the
 * worst case is re-observing sessions, which the observation ledger's
 * evidence-hash dedupe absorbs.
 */
export async function loadRetroState(boxRoot: string): Promise<RetroState> {
  const filePath = path.join(boxRoot, STATE_FILE);
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`retro: could not read ${STATE_FILE}, starting fresh:`, e);
    }
    return emptyRetroState();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    console.warn(`retro: ${STATE_FILE} is not valid JSON, starting fresh:`, e);
    return emptyRetroState();
  }

  const parsed = RetroStateSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`retro: ${STATE_FILE} did not match the expected shape, starting fresh`);
    return emptyRetroState();
  }
  return parsed.data;
}

export async function saveRetroState(boxRoot: string, state: RetroState): Promise<void> {
  const filePath = path.join(boxRoot, STATE_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}
