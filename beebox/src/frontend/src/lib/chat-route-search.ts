/** The chat route's search parameters (`router.tsx`'s `/chat`). */

import { z } from "zod";

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
});
