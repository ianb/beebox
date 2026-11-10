/** The chat route's search parameters (`router.tsx`'s `/chat`). */

import { z } from "zod";
import { trpcClient } from "./trpc/client";

export const chatSearchSchema = z.object({
  new: z.union([z.literal("1"), z.literal(1)]).optional(),
  // Shown above the composer and carried into the first message (ChatNotificationBanner).
  notification: z.coerce.string().optional(),
  session: z.string().optional(),
  // A `place:<dir>` notification: the route resolves it to the place's latest chat (`notificationChatSearch`).
  place: z.string().optional(),
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

/** The box lookups a notification link needs, injected so tests need no server. */
export interface PlaceLookups {
  /** Whether `dir` is still a place. */
  isPlace: (dir: string) => Promise<boolean>;
  /** The place's latest chat, or null when it has none. */
  latestChat: (dir: string) => Promise<string | null>;
}

/** `dir` when it is still a place; otherwise warns and returns undefined, so the chat opens at the box root. */
async function stillAPlace(dir: string, isPlace: PlaceLookups["isPlace"]): Promise<string | undefined> {
  try {
    if (await isPlace(dir)) return dir;
    console.warn(`[notifications] the place "${dir}" is gone; opening the chat at the box root`);
  } catch (error) {
    console.warn(`[notifications] could not check the place "${dir}"; opening the chat at the box root`, error);
  }
  return undefined;
}

/**
 * The search a notification link redirects to, or null when `search` is not
 * a notification link. `?new=1` is a fresh conversation (`session=new`); a
 * `chat:new:<place>` link carries the place as `contextDir`. `?place=` opens
 * the place's latest chat, or a fresh one there when it has none. When the
 * place is gone or the lookup fails, a fresh chat opens at the box root,
 * still showing the notification.
 */
export async function notificationChatSearch(search: ChatSearch, lookups: PlaceLookups): Promise<ChatSearch | null> {
  const { new: fresh, place, contextDir, ...others } = search;
  if (place !== undefined) {
    const dir = await stillAPlace(place, lookups.isPlace);
    if (dir === undefined) return { ...others, session: "new" };
    let latest: string | null = null;
    try {
      latest = await lookups.latestChat(dir);
    } catch (error) {
      console.warn(`[notifications] could not find the latest chat in "${dir}"; opening a new chat there`, error);
    }
    return latest === null ? { ...others, session: "new", contextDir: dir } : { ...others, session: latest };
  }
  if (fresh === undefined) return null;
  if (contextDir === undefined || contextDir === "") return { ...others, session: "new" };
  const dir = await stillAPlace(contextDir, lookups.isPlace);
  return dir === undefined ? { ...others, session: "new" } : { ...others, session: "new", contextDir: dir };
}

/** The lookups against this box. `isPlace` is the send-time check's predicate (`core/notification/target-check.ts`). */
export const placeLookups: PlaceLookups = {
  isPlace: async (dir) => (await trpcClient.landmarks.identity.query({ dir })).identity !== null,
  latestChat: async (dir) => (await trpcClient.chat.lastSessionForDirectory.query({ contextDir: dir })).sessionId,
};
