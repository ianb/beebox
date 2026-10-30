/** Persist only identities/labels so reload can refresh this tab's background work. */
import { z } from "zod";
import { readSessionJson, writeSessionJson } from "../../../lib/session-json";
import type { AmbientSession } from "./AmbientReplies/view";

const sessionsSchema = z.array(z.object({ sessionId: z.string(), label: z.string() }));
const WHAT = "Tracked conversations";
export function readTrackedSessions(storageScope: string): AmbientSession[] {
  return readSessionJson({ key: `bbx-ambient-sessions:${storageScope}`, schema: sessionsSchema, fallback: [], what: WHAT });
}
export function writeTrackedSessions(storageScope: string, sessions: AmbientSession[]): void {
  writeSessionJson({ key: `bbx-ambient-sessions:${storageScope}`, value: sessions, what: WHAT });
}
