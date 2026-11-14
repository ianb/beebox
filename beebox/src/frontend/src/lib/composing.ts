/**
 * What this person is doing in the chat composer now, for the others in the
 * chat (docs/chat-presence.md, "Composing"). The composer reports
 * keystrokes and dictation here; `PresenceHeads` sends the result to the
 * room. A module store, so a keystroke re-renders nothing above the textarea.
 */

import type { Composing } from "@core/chat/presence/types.js";
import { useEffect } from "react";
import { trpcClient } from "./trpc/client";

/** Typing ends this long after the last keystroke. */
export const TYPING_IDLE_MS = 5_000;
/** A composing state is re-sent this often; the server clears one not re-sent within its `COMPOSING_TTL_MS` (8 s). */
const REFRESH_MS = 3_000;

interface State {
  lastTypedAt: number | null;
  textEmpty: boolean;
  dictating: boolean;
}

/** What a state shows at `now`: dictating wins; typing needs text and a recent keystroke. */
export function composingAt(state: State, now: number): Composing | null {
  if (state.dictating) return "dictating";
  if (state.textEmpty || state.lastTypedAt === null) return null;
  return now - state.lastTypedAt < TYPING_IDLE_MS ? "typing" : null;
}

let state: State = { lastTypedAt: null, textEmpty: true, dictating: false };
let current: Composing | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function update(next: State): void {
  state = next;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  const now = Date.now();
  const shown = composingAt(state, now);
  if (shown === "typing" && state.lastTypedAt !== null) {
    idleTimer = setTimeout(() => update(state), TYPING_IDLE_MS - (now - state.lastTypedAt));
  }
  if (shown === current) return;
  current = shown;
  for (const listener of listeners) listener();
}

export const composing = {
  /** A keystroke in the composer left this text. */
  noteTyped(text: string): void {
    update({ ...state, lastTypedAt: Date.now(), textEmpty: text.trim() === "" });
  },
  /** The composer's text became empty (a send or a clear): not typing. */
  noteCleared(): void {
    if (!state.textEmpty) update({ ...state, textEmpty: true });
  },
  /** Typing so far belongs to another chat: the composer keeps its draft across a switch. */
  forgetTyping(): void {
    if (state.lastTypedAt !== null) update({ ...state, lastTypedAt: null });
  },
  setDictating(on: boolean): void {
    if (state.dictating !== on) update({ ...state, dictating: on });
  },
  get: (): Composing | null => current,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/**
 * Send what this person is composing to a chat's room while they are present in it:
 * on each change, again every few seconds while there is one (the server
 * forgets one that stops coming), and null when this ends with one set. Sends
 * are chained so a "stopped" never overtakes the "typing" before it. Returns
 * the stop.
 */
export function reportComposingTo(sessionId: string): () => void {
  composing.forgetTyping();
  let sent: Composing | null = null;
  let chain = Promise.resolve();
  const send = (doing: Composing | null): void => {
    chain = chain.then(async () => {
      try {
        await trpcClient.chatPresence.setComposing.mutate({ sessionId, doing });
      } catch (err) {
        console.warn(`[chat-presence] composing state not sent: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };
  const sync = (): void => {
    const doing = composing.get();
    if (doing === sent) return;
    sent = doing;
    send(doing);
  };
  sync();
  const unsubscribe = composing.subscribe(sync);
  const refresh = setInterval(() => {
    if (sent !== null) send(sent);
  }, REFRESH_MS);
  return () => {
    unsubscribe();
    clearInterval(refresh);
    if (sent !== null) send(null);
  };
}

/** Mirror the web composer's dictation into `composing` (the shell calls this). */
export function useReportDictating(on: boolean): void {
  useEffect(() => {
    composing.setDictating(on);
    return () => composing.setDictating(false);
  }, [on]);
}
