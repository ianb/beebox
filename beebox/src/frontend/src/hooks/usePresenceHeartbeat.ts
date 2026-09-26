/**
 * Report that a person is using this tab, so a `quiet` notification shows in
 * the app instead of buzzing a phone (docs/plans/notifications.md, Track A,
 * presence).
 *
 * While the tab is visible and the person has interacted in the last two
 * minutes (`pointerdown`, `keydown`, or the tab becoming visible), send
 * `presence.heartbeat` every 30 seconds, and at once when an interaction ends
 * a quiet spell. A hidden or idle tab sends nothing; the server counts a tab
 * for 90 seconds after its last heartbeat.
 */

import { useEffect } from "react";
import { trpcClient } from "../lib/trpc";

const HEARTBEAT_MS = 30_000;
const IDLE_MS = 120_000;

/** One id per page load of this tab; the server counts distinct ids. */
const TAB_SESSION_ID = `tab-${crypto.randomUUID()}`;

export function usePresenceHeartbeat(): void {
  useEffect(() => {
    let lastInteraction = document.visibilityState === "visible" ? Date.now() : 0;
    let lastBeat = 0;
    const beat = () => {
      const now = Date.now();
      if (document.visibilityState !== "visible" || now - lastInteraction > IDLE_MS) return;
      lastBeat = now;
      trpcClient.presence.heartbeat.mutate({ sessionId: TAB_SESSION_ID }).catch((e: unknown) => {
        // The next beat retries; a missed one only lets a quiet notification reach the phone.
        console.warn("[presence] heartbeat failed:", e);
      });
    };
    const interacted = () => {
      if (document.visibilityState !== "visible") return;
      lastInteraction = Date.now();
      if (lastInteraction - lastBeat >= HEARTBEAT_MS) beat();
    };
    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    window.addEventListener("pointerdown", interacted, { passive: true });
    window.addEventListener("keydown", interacted, { passive: true });
    document.addEventListener("visibilitychange", interacted);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pointerdown", interacted);
      window.removeEventListener("keydown", interacted);
      document.removeEventListener("visibilitychange", interacted);
    };
  }, []);
}
