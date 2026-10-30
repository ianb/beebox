/** Active observer IDs only: idle acknowledged chats retain no history query. */
import { z } from "zod";
import { readSessionJson, writeSessionJson } from "../../../../lib/session-json";

const WHAT = "Active conversations";
export function readActiveSessions(storageScope: string): string[] {
  return readSessionJson({ key: `bbx-ambient-active:${storageScope}`, schema: z.array(z.string()), fallback: [], what: WHAT });
}
export function writeActiveSessions(storageScope: string, ids: string[]): void {
  writeSessionJson({ key: `bbx-ambient-active:${storageScope}`, value: ids, what: WHAT });
}
