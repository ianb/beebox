/** Active observer IDs only: idle acknowledged chats retain no history query. */
import { z } from "zod";

export function readActiveSessions(storageScope: string): string[] {
  if (!("sessionStorage" in globalThis)) return [];
  try {
    const value = z.array(z.string()).safeParse(JSON.parse(sessionStorage.getItem(`bbx-ambient-active:${storageScope}`) ?? "[]"));
    return value.success ? value.data : [];
  } catch (error) { console.warn("Could not restore active conversations", error); return []; }
}
export function writeActiveSessions(storageScope: string, ids: string[]): void {
  try { sessionStorage.setItem(`bbx-ambient-active:${storageScope}`, JSON.stringify(ids)); }
  catch (error) { console.warn("Could not save active conversations", error); }
}
