/**
 * Chat presence over the WebSocket. A tab or the iOS web view subscribes to
 * `watch` while a chat is its current conversation and the page is visible;
 * being subscribed is being present. Each subscriber hears everyone else in
 * the same chat. The server, not the client, says who a subscriber is
 * (`ctx.user`). See docs/chat-presence.md.
 */

import { z } from "zod";
import { router, authedProcedure } from "../procedures.js";
import { createChatPresence, type ChatPresenceFrame, type PresentPerson } from "../../../core/chat/presence/room.js";
import { localUserName } from "../../auth.js";
import type { TrpcContext } from "../context.js";

const presence = createChatPresence();

/**
 * The person this request is, or null when it is no person: the box's own agent
 * (its bearer, or its browser on a box that lets it act as the owner) and an
 * open-access box with no identity are never shown as present.
 */
function personFor(ctx: TrpcContext): PresentPerson | null {
  if (ctx.user === null || ctx.actor === "agent") return null;
  const { email, name } = ctx.user;
  // A paired device carries only the email; the local-user store may know the name.
  return { email, name: name === email ? (localUserName(email) ?? email) : name };
}

export const chatPresenceRouter = router({
  watch: authedProcedure
    .input(z.object({ sessionId: z.string().regex(/^[\w-]{8,64}$/) }))
    .subscription(async function* (opts): AsyncGenerator<ChatPresenceFrame> {
      const signal = opts.signal;
      const person = personFor(opts.ctx);
      const queue: ChatPresenceFrame[] = [];
      let wake: (() => void) | null = null;
      const ping = (): void => {
        if (wake) {
          wake();
          wake = null;
        }
      };
      let leave: (() => void) | null = null;
      if (person === null) {
        queue.push({ t: "others", people: [] });
      } else {
        leave = presence.join({
          boxRoot: opts.ctx.boxRoot,
          sessionId: opts.input.sessionId,
          person,
          onChange: (people) => {
            // Only the newest list matters; an unsent older one is dropped.
            queue.length = 0;
            queue.push({ t: "others", people });
            ping();
          },
        });
      }
      signal?.addEventListener("abort", ping, { once: true });
      try {
        while (signal?.aborted !== true) {
          const frame = queue.shift();
          if (frame === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          yield frame;
        }
      } finally {
        leave?.();
      }
    }),
});
