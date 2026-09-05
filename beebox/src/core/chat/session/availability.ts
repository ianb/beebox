import * as fs from "node:fs/promises";
import { errnoCode } from "../../../lib/error-guards.js";
import { findChatHuskEntry, type ChatHuskEntry } from "../husk-read.js";
import { resolveSessionLogPath } from "./history.js";
import type { ChatSessionRegistry } from "./registry.js";
import { resolveChatEngine } from "./engine.js";
import { codexSessionExists } from "./codex-transcript.js";
import { localOrigin } from "./origin.js";

/**
 * Where a chat's transcript is — the question a husk alone cannot answer.
 *
 * A transcript lives in one engine store on one machine and expires there, so
 * "not here" has three different meanings, and the husk's recorded origin
 * (`docs/implemented-plans/chat-session-identity.md`, Track 2) is what tells them apart.
 * A union rather than a bare "missing" reason so every surface has to say
 * which one it means.
 */
export type TranscriptState =
  /** Readable on this machine — the chat resumes. */
  | { state: "present" }
  /** This machine's, but the engine's retention window has passed. */
  | { state: "expired" }
  /** It ran on another machine; nothing here ever held it. */
  | { state: "elsewhere"; originName: string }
  /** No origin recorded (a husk written before the provenance fields). */
  | { state: "unknown" };

/**
 * Derive a husk's transcript state from the one runtime fact (`present`) and
 * the one durable fact (the husk's `origin`).
 *
 * A husk with no origin reads as `unknown` rather than `expired`: pre-Track-2
 * husks predate the stamp, and guessing would report another machine's chat as
 * this one's expired chat. Reconcile backfills the field, so `unknown` decays.
 */
export async function deriveTranscriptState(args: { husk: ChatHuskEntry | null; present: boolean }): Promise<TranscriptState> {
  if (args.present) return { state: "present" };
  const origin = args.husk?.origin;
  if (origin === undefined) return { state: "unknown" };
  if (origin === (await localOrigin()).id) return { state: "expired" };
  // The label is what a person reads; the id is the only thing guaranteed to
  // be there, so it stands in when the husk carries no name.
  return { state: "elsewhere", originName: args.husk?.originName ?? origin };
}

export type SessionAvailability =
  | { kind: "resumable" }
  | {
      kind: "unavailable";
      reason: "deletion-in-progress";
      huskPath: string | null;
    }
  | {
      kind: "unavailable";
      reason: "missing-local-transcript";
      /** Why it is missing — never `present` in this branch. */
      transcript: TranscriptState;
      huskPath: string | null;
    };

/** The `unavailable`/`missing-local-transcript` answer for a resolved husk. */
async function missingTranscript(husk: ChatHuskEntry | null): Promise<SessionAvailability> {
  return {
    kind: "unavailable",
    reason: "missing-local-transcript",
    transcript: await deriveTranscriptState({ husk, present: false }),
    huskPath: husk?.path ?? null,
  };
}

/** Resolve whether an existing id can safely reach the SDK resume path. */
export async function resolveSessionAvailability(args: { boxRoot: string; sessionId: string; registry: ChatSessionRegistry }): Promise<SessionAvailability> {
  if (args.registry.deletion.isBlocked(args.sessionId)) {
    const husk = await findChatHuskEntry(args.boxRoot, args.sessionId);
    return { kind: "unavailable", reason: "deletion-in-progress", huskPath: husk?.path ?? null };
  }
  if (args.registry.deletion.hasAssignedSession(args.sessionId)) return { kind: "resumable" };
  // A reserved chat (`reserve.ts`) is addressable before it has written
  // anything, so the transcript checks below would call it a ghost and the
  // first send into a coined chat would 410. Checked after the deletion gates,
  // never before: a chat being deleted stays refused whatever else is true.
  if (args.registry.getReservation(args.sessionId) !== null) return { kind: "resumable" };
  // The husk is read before the engine question, not after: it carries the
  // `engine` stamp `resolveChatEngine` prefers, and both branches below want it.
  const husk = await findChatHuskEntry(args.boxRoot, args.sessionId);
  if (await resolveChatEngine(args.boxRoot, { sessionId: args.sessionId, husk }) === "codex") {
    if (await codexSessionExists(args.boxRoot, args.sessionId)) return { kind: "resumable" };
    return missingTranscript(husk);
  }
  const logPath = await resolveSessionLogPath(args.boxRoot, args.sessionId);
  try {
    await fs.access(logPath);
    return { kind: "resumable" };
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    return missingTranscript(husk);
  }
}
