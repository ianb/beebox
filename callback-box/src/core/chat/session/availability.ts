import * as fs from "node:fs/promises";
import { errnoCode } from "../../../lib/error-guards.js";
import { findChatHuskEntry } from "../husk.js";
import { resolveSessionLogPath } from "./history.js";
import type { ChatSessionRegistry } from "./registry.js";
import { resolveChatEngine } from "./engine.js";
import { readCodexSessionUpdatedAt } from "./codex-transcript.js";

export type SessionAvailability =
  | { kind: "resumable" }
  | {
      kind: "unavailable";
      reason: "missing-local-transcript" | "deletion-in-progress";
      huskPath: string | null;
    };

/** Resolve whether an existing id can safely reach the SDK resume path. */
export async function resolveSessionAvailability(args: { boxRoot: string; sessionId: string; registry: ChatSessionRegistry }): Promise<SessionAvailability> {
  if (args.registry.deletion.isBlocked(args.sessionId)) {
    const husk = await findChatHuskEntry(args.boxRoot, args.sessionId);
    return { kind: "unavailable", reason: "deletion-in-progress", huskPath: husk?.path ?? null };
  }
  if (args.registry.deletion.hasAssignedSession(args.sessionId)) return { kind: "resumable" };
  if (await resolveChatEngine(args.boxRoot, args.sessionId) === "codex") {
    await readCodexSessionUpdatedAt(args.boxRoot, args.sessionId);
    return { kind: "resumable" };
  }
  const [husk, logPath] = await Promise.all([findChatHuskEntry(args.boxRoot, args.sessionId), resolveSessionLogPath(args.boxRoot, args.sessionId)]);
  try {
    await fs.access(logPath);
    return { kind: "resumable" };
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    return {
      kind: "unavailable",
      reason: "missing-local-transcript",
      huskPath: husk?.path ?? null,
    };
  }
}
