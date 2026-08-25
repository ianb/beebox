/**
 * Coining a chat id for a brand-new chat.
 *
 * A chat used to have no id until the harness assigned one part-way through
 * its first run, which is why the composer disabled capture and bulk upload
 * with "send a message first": those deliver server-side and had no chat to
 * name. The browser now mints a UUID when it opens a new chat and asks the box
 * to reserve it; from that moment the chat is an ordinary addressable chat.
 *
 * Two answers mean "carry on the old way", and both are normal:
 *  - `unsupported` — a Codex box, whose harness names its own threads.
 *  - `taken` twice — vanishingly unlikely, but a coin flip we do not retry
 *    forever.
 *
 * Nothing renders until this settles. The alternative — mounting the chat as
 * `"new"` while the reservation is in flight — lets a fast typist send a
 * message into a chat the harness names itself, and the navigation to the
 * coined id would then swap them onto a different, empty chat and lose it.
 */

import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";

export type CoinedChat =
  /** The reservation is in flight; render nothing yet. */
  | { state: "pending" }
  /** Reserved — navigate to `?session=<sessionId>` and treat it as any chat. */
  | { state: "coined"; sessionId: string }
  /** This box cannot coin (Codex), or coining failed: use the `"new"` path. */
  | { state: "unavailable" };

/** How many times to re-mint after a `taken` collision before giving up. */
const MAX_ATTEMPTS = 2;

export function useCoinedChat(opts: { enabled: boolean; contextDir: string | undefined }): CoinedChat {
  const { enabled, contextDir } = opts;
  // `attempt` identifies WHICH new-chat this state describes. The page does not
  // remount between chats, so without it the hook would hand a second "New
  // chat" the id it coined for the first, and the page would navigate straight
  // back into that chat instead of starting one.
  const [state, setState] = useState<{ enabled: boolean; attempt: number; value: CoinedChat }>({
    enabled,
    attempt: 0,
    value: { state: "pending" },
  });
  // Adjusting state during render (the React "derived from props" pattern):
  // this re-renders immediately with the reset value, so no effect ever sees —
  // and no consumer ever reads — a stale coined id for a new chat.
  if (state.enabled !== enabled) {
    setState({
      enabled,
      attempt: enabled ? state.attempt + 1 : state.attempt,
      value: { state: "pending" },
    });
  }
  const attempt = state.attempt;
  const reserve = trpc.chat.reserveSession.useMutation();
  // `mutateAsync` is stable across renders; naming it separately keeps it out
  // of the effect's dependency list as the whole mutation object would not be.
  const { mutateAsync } = reserve;

  useEffect(() => {
    if (!enabled) return;
    // An AbortController rather than a captured boolean: the compiler narrows a
    // `let cancelled = false` to "always false" inside the closure and flags
    // every check as unnecessary, while `signal.aborted` is a getter it cannot
    // narrow — and cancellation is what the primitive is for.
    const abort = new AbortController();
    void (async (): Promise<void> => {
      for (let tries = 0; tries < MAX_ATTEMPTS; tries++) {
        const sessionId = crypto.randomUUID();
        try {
          const outcome = await mutateAsync({
            sessionId,
            // `""` is forwarded, not dropped: it is the box-root landmark
            // (`useOpenLandmarkChat` sends exactly that for the Box row), and
            // the reservation is what names the chat's place until its first
            // turn commits a history row. Only an absent param means the chat
            // was opened from nowhere.
            ...(contextDir !== undefined ? { contextDir } : {}),
          });
          if (abort.signal.aborted) return;
          if (outcome.kind === "reserved") {
            setState({ enabled: true, attempt, value: { state: "coined", sessionId: outcome.sessionId } });
            return;
          }
          if (outcome.kind === "unsupported") break;
          // `taken`: the id names an existing chat. Mint another and retry.
        } catch (e) {
          // A box mid-restart, or an older build with no such procedure. The
          // `"new"` path still works, so this degrades rather than blocks.
          console.warn("[chat] Reserving a coined chat id failed; starting an unnamed chat instead:", e);
          break;
        }
      }
      if (!abort.signal.aborted) setState({ enabled: true, attempt, value: { state: "unavailable" } });
    })();
    return () => {
      abort.abort();
    };
  }, [enabled, contextDir, mutateAsync, attempt]);

  return enabled ? state.value : { state: "unavailable" };
}
