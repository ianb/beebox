/** Persist only identities/labels so reload can refresh this tab's background work. */
import { z } from "zod";
import type { AmbientSession } from "./AmbientReplies";

const sessionsSchema = z.array(z.object({ sessionId: z.string(), label: z.string() }));
export function readTrackedSessions(boxSlug: string): AmbientSession[] {
  if (!("sessionStorage" in globalThis)) return [];
  try {
    const result = sessionsSchema.safeParse(JSON.parse(sessionStorage.getItem(`bbx-ambient-sessions:${boxSlug}`) ?? "[]"));
    return result.success ? result.data : [];
  } catch (error) { console.warn("Could not restore tracked conversations", error); return []; }
}
export function writeTrackedSessions(boxSlug: string, sessions: AmbientSession[]): void {
  try { sessionStorage.setItem(`bbx-ambient-sessions:${boxSlug}`, JSON.stringify(sessions)); }
  catch (error) { console.warn("Could not save tracked conversations", error); }
}
