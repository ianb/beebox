/**
 * Retrospective walker state — which sessions have been processed.
 *
 * Persisted at `.beebox/retro/state.json` (box-local machine state,
 * like the chat registries). A session marked `done` is never re-observed;
 * a `failed` session is retried on later runs until it exhausts
 * {@link MAX_OBSERVE_ATTEMPTS}, after which it is skipped permanently
 * (and reported as such).
 */

import * as path from "node:path";
import { z } from "zod";
import { loadJsonStateOrFresh } from "../../lib/json-state.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";

const STATE_FILE = ".beebox/retro/state.json";

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
  return loadJsonStateOrFresh({
    filePath: path.join(boxRoot, STATE_FILE),
    name: STATE_FILE,
    label: "retro",
    schema: RetroStateSchema,
    fresh: emptyRetroState,
  });
}

export async function saveRetroState(boxRoot: string, state: RetroState): Promise<void> {
  await writeFileAtomic(path.join(boxRoot, STATE_FILE), { content: JSON.stringify(state, null, 2) + "\n" });
}
