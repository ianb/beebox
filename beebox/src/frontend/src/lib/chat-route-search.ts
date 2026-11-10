/** The chat route's search parameters (`router.tsx`'s `/chat`). */

import { z } from "zod";
import { trpcClient } from "./trpc/client";

export const chatSearchSchema = z.object({
  new: z.union([z.literal("1"), z.literal(1)]).optional(),
  // Shown above the composer and carried into the first message (ChatNotificationBanner).
  notification: z.coerce.string().optional(),
  session: z.string().optional(),
  contextDir: z.string().optional(),
  // A `view:` URL to open in the companion pane when the chat loads (e.g. a
  // commentary card captured by the clerk extension). Opened once on mount.
  companion: z.string().optional(),
  // The card live-open in the companion pane (serialized view URL, no
  // `view:` prefix). Persisted so a reload restores it; kept in sync as the
  // active card changes. Distinct from `companion`, which is a one-shot
  // deep-link opened only on mount.
  card: z.string().optional(),
  // Native iOS mode: preserve web navigation and chat controls while the
  // shell supplies a keyboard-safe native composer.
  nativeComposer: z.union([z.literal("1"), z.literal(1)]).optional(),
  // Open capture mode on load — the `/capture` deep link redirects here.
  capture: z.union([z.literal("1"), z.literal(1)]).optional(),
  // Land on a specific transcript entry (a chat-search result's anchor
  // uuid). One-shot on load, like `companion` — never re-scrolled on
  // refreshes. Ignored when the entry isn't in the transcript.
  m: z.string().optional(),
});

type ChatSearch = z.infer<typeof chatSearchSchema>;

/**
 * The search a notification's `?new=1` link redirects to: a fresh
 * conversation (`session=new`). A `chat:new:<place>` link carries the place as
 * `contextDir`; when the place is gone or the lookup fails, the chat opens at
 * the box root instead, still showing the notification.
 */
export async function notificationChatSearch(rest: Omit<ChatSearch, "new">, isPlace: (dir: string) => Promise<boolean>): Promise<ChatSearch> {
  const { contextDir, ...others } = rest;
  if (contextDir === undefined || contextDir === "") return { ...others, session: "new" };
  let exists = false;
  try {
    exists = await isPlace(contextDir);
  } catch (error) {
    console.warn(`[notifications] could not check the place "${contextDir}"; opening the chat at the box root`, error);
    return { ...others, session: "new" };
  }
  if (!exists) console.warn(`[notifications] the place "${contextDir}" is gone; opening the chat at the box root`);
  return exists ? { ...others, session: "new", contextDir } : { ...others, session: "new" };
}

/** Whether `dir` holds a landmark card that parses: the send-time check's predicate (`core/notification/target-check.ts`). */
export async function placeExists(dir: string): Promise<boolean> {
  return (await trpcClient.landmarks.identity.query({ dir })).identity !== null;
}
