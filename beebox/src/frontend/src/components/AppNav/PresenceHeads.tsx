/**
 * Who else has this chat open, under the profile avatar (docs/chat-presence.md).
 *
 * Being subscribed to `chatPresence.watch` is being present, so this
 * subscribes only while the person is in the chat: it is the current
 * conversation and the page is active. In a browser, active is visible and
 * focused. In the iOS web view, it is visible and shown: the native composer
 * takes DOM focus from the page while the person types, and the app keeps the
 * page mounted but hidden behind its native box screen, which it reports as
 * `window.beeboxShellShown` and the `beebox:shell-shown` event.
 */

import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../lib/trpc/client";
import { useBoxConversation } from "../chat/everywhere/conversation-context/context";
import { isNativeShell } from "../chat/native-post";
import { PresenceHeadsFace, type PresenceHead } from "../app-bar-faces/PresenceHeadsFace";

declare global {
  interface Window {
    /** Set by the iOS app: false while its native box screen covers this page. */
    beeboxShellShown?: boolean;
  }
}

const NO_ONE: readonly PresenceHead[] = [];

function pageActive(): boolean {
  if (document.visibilityState !== "visible") return false;
  if (isNativeShell()) return window.beeboxShellShown !== false;
  return document.hasFocus();
}

/** Whether the person is looking at this page now; see the module comment. */
function usePageActive(): boolean {
  const [active, setActive] = useState(pageActive);
  useEffect(() => {
    const update = () => setActive(pageActive());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    window.addEventListener("beebox:shell-shown", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("beebox:shell-shown", update);
    };
  }, []);
  return active;
}

/**
 * Join only after the person has been in the chat this long. tRPC's WebSocket
 * adapter drops a `subscription.stop` that arrives before it has registered the
 * subscription, which would leave a watcher in the room until the socket
 * closes; a start that has held this long is registered before its stop
 * comes. Leaving is immediate.
 */
const JOIN_AFTER_MS = 1000;

/** `value` once it has held for `ms`; null at once whenever `value` is null. */
function useSettled(value: string | null, ms: number): string | null {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (value === null) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => {
      clearTimeout(timer);
      setSettled(null);
    };
  }, [value, ms]);
  return settled === value ? settled : null;
}

/** The people one subscription last reported, and the chat they are in. */
interface Report {
  sessionId: string;
  people: readonly PresenceHead[];
}

/**
 * Which heads to draw: a live subscription's latest report, only for the chat
 * the person is in now. A reconnecting socket's last list may be stale, and a
 * report from the chat they just left belongs to that chat.
 */
export function headsToShow(opts: { live: boolean; inChat: string | null; report: Report | null }): readonly PresenceHead[] {
  const { live, inChat, report } = opts;
  if (!live || inChat === null || report === null || report.sessionId !== inChat) return NO_ONE;
  return report.people;
}

/** The other people present in the chat the person is in, or none. */
function useChatPresence(inChat: string | null): readonly PresenceHead[] {
  const watched = useSettled(inChat, JOIN_AFTER_MS);
  const [report, setReport] = useState<Report | null>(null);
  const sub = trpc.chatPresence.watch.useSubscription(
    { sessionId: watched ?? "" },
    {
      enabled: watched !== null,
      // A new or restarted subscription starts from nobody until its first frame.
      onStarted: useCallback(() => setReport(null), []),
      // The hook calls the latest options, so a frame is labelled with the chat its subscription watches.
      onData: useCallback((frame: { t: "others"; people: PresenceHead[] }) => {
        setReport(watched === null ? null : { sessionId: watched, people: frame.people });
      }, [watched]),
      onError: useCallback((err: { message: string }) => {
        // wsLink reconnects on its own; with no live subscription no heads show.
        console.warn(`[chat-presence] ${err.message}`);
      }, []),
    },
  );
  return headsToShow({ live: sub.status === "pending", inChat, report });
}

export function PresenceHeads() {
  const conversation = useBoxConversation();
  const active = usePageActive();
  const target = conversation?.rendered?.target;
  // A session this tab just reserved counts too: its first turn may already be
  // committed while the tab still holds the reservation, and until then no one
  // else can know its id.
  const sessionId = target?.kind === "session" ? target.sessionId : null;
  const people = useChatPresence(active ? sessionId : null);
  return <PresenceHeadsFace people={people} />;
}
