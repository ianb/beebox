/**
 * The engine chosen for a coined-but-unstarted chat, readable by the engine
 * resolvers.
 *
 * A coined chat's engine lives in its reservation until the first turn writes
 * the history row — but `resolveChatEngine`/`resolveStartEngine` read only the
 * husk and the history file, so every reader (bootstrap, history, the warm
 * probe, the run start) fell through to the box default for the whole
 * reserved-but-unstarted window. On a codex-default box with a `?engine=claude`
 * pick that meant Codex history reads that fail and a coined run tripping the
 * coined-must-be-Claude invariant (the 500s of 2026-08-27/28).
 *
 * Module-level because the resolvers are free functions and the reservation
 * store is per-registry: session ids are UUIDs, so a process-wide map keyed by
 * id cannot collide across boxes. In-memory matches reservation semantics —
 * the reserving process is the only one that can address the chat before its
 * first turn. `ChatReservationStore` owns every mutation (set, release,
 * expiry), so an entry here never outlives its reservation.
 */
import type { AgentEngine } from "../../box/config.js";

const engines = new Map<string, AgentEngine>();

export function recordCoinedEngine(sessionId: string, engine: AgentEngine): void {
  engines.set(sessionId, engine);
}

export function forgetCoinedEngine(sessionId: string): void {
  engines.delete(sessionId);
}

/** The reserved engine for a coined-but-unstarted chat, or null. */
export function coinedEngineFor(sessionId: string): AgentEngine | null {
  return engines.get(sessionId) ?? null;
}
