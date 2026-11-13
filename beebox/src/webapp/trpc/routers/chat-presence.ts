/**
 * Chat presence over the WebSocket. A tab or the iOS web view subscribes to
 * `watch` while a chat is its current conversation and the page is active;
 * being subscribed is being present. Each subscriber hears everyone else in
 * the same chat and the chat's call, if any. The server, not the client, says
 * who a subscriber is (`ctx.user`). See docs/chat-presence.md.
 */

import { z } from "zod";
import { router, authedProcedure } from "../procedures.js";
import type { ChatPresenceFrame } from "../../../core/chat/presence/room.js";
import { chatRoom, personFor, SESSION_ID_RE } from "../chat-room.js";

export const chatPresenceRouter = router({
  watch: authedProcedure
    .input(z.object({ sessionId: z.string().regex(SESSION_ID_RE) }))
    .subscription(async function* (opts): AsyncGenerator<ChatPresenceFrame> {
      const signal = opts.signal;
      const person = personFor(opts.ctx);
      // Both kinds are states: only the newest unsent frame of each matters.
      const pending = new Map<ChatPresenceFrame["t"], ChatPresenceFrame>();
      let wake: (() => void) | null = null;
      const ping = (): void => {
        if (wake) {
          wake();
          wake = null;
        }
      };
      let leave: (() => void) | null = null;
      if (person === null) {
        pending.set("others", { t: "others", people: [] });
      } else {
        leave = chatRoom.join({
          boxRoot: opts.ctx.boxRoot,
          sessionId: opts.input.sessionId,
          person,
          onFrame: (frame) => {
            pending.delete(frame.t);
            pending.set(frame.t, frame);
            ping();
          },
        });
      }
      signal?.addEventListener("abort", ping, { once: true });
      try {
        while (signal?.aborted !== true) {
          const next = pending.entries().next();
          if (next.done === true) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          const [kind, frame] = next.value;
          pending.delete(kind);
          yield frame;
        }
      } finally {
        leave?.();
      }
    }),
});
