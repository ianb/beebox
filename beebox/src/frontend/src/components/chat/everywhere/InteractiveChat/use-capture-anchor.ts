/**
 * The DOM half of the capture anchor: reads the list and the scroller, and
 * asks `capture-anchor.ts` what to put at the top. Split out of `messages.tsx`
 * to keep that file within its line budget.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { parseDeliveredUserMessageParts } from "@shared/delivered-user-message";
import type { MessageGroup } from "../../ChatMessages/view";
import type { CaptureBubbleModel } from "../../capture-bubble";
import { startCaptureWait, stepCaptureWait, type CaptureAnchorView, type CaptureAnchorWait } from "./capture-anchor";

/** The newest delivered capture message's identity, to tell a new arrival from the last one. */
function lastCaptureUuid(groups: MessageGroup[]): string | null {
  for (const group of groups.toReversed()) {
    if (group.type !== "user") continue;
    for (const entry of group.entries.toReversed()) {
      const isCapture = entry.content.some((block) => block.type === "text" && block.text !== undefined
        && parseDeliveredUserMessageParts(block.text).some((part) => part.kind === "capture"));
      if (isCapture) return entry.uuid;
    }
  }
  return null;
}

/** Done in capture anchors the capture when it shows up; see `capture-anchor.ts`. */
export function useCaptureAnchor(opts: {
  captureSignal: number;
  sendSignal: number;
  groups: MessageGroup[];
  captureBubbles: CaptureBubbleModel[];
  contentElRef: React.RefObject<HTMLDivElement | null>;
  anchorToTop: (el: Element | null) => void;
}): void {
  const { captureSignal, sendSignal, groups, captureBubbles, contentElRef, anchorToTop } = opts;
  const newestCapture = useMemo(() => lastCaptureUuid(groups), [groups]);
  const wait = useRef<CaptureAnchorWait | null>(null);
  // The list as of the previous commit: the one Done closed over.
  const seen = useRef<Pick<CaptureAnchorView, "newestCapture" | "bubbleIds">>({ newestCapture, bubbleIds: [] });
  const lastCaptureSignal = useRef(captureSignal);
  const lastSendSignal = useRef(sendSignal);
  const { readScrolled, resetScrolled } = useReaderScrolled(contentElRef);

  useLayoutEffect(() => {
    const bubbleIds = captureBubbles.map((b) => b.id);
    // A typed send takes the anchor and ends any wait.
    if (sendSignal !== lastSendSignal.current) {
      lastSendSignal.current = sendSignal;
      wait.current = null;
    }
    if (captureSignal !== lastCaptureSignal.current) {
      lastCaptureSignal.current = captureSignal;
      wait.current = startCaptureWait(seen.current);
    }
    seen.current = { newestCapture, bubbleIds };
    const content = contentElRef.current;
    if (wait.current === null || !content) return;
    const now: CaptureAnchorView = { newestCapture, bubbleIds, readerScrolled: readScrolled() };
    const { wait: next, step } = stepCaptureWait(wait.current, now);
    wait.current = next;
    if (step.anchor === "user") {
      const users = content.querySelectorAll("[data-role=\"user\"]");
      anchorToTop(users[users.length - 1] ?? null);
    } else if (step.anchor === "bubble") {
      // Bubbles render in model order after the transcript, so the DOM index matches.
      resetScrolled();
      anchorToTop(content.querySelectorAll("[data-role=\"captureBubble\"]")[step.index] ?? null);
    }
  }, [captureSignal, sendSignal, newestCapture, captureBubbles, contentElRef, anchorToTop, readScrolled, resetScrolled]);
}

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/** Whether the reader has scrolled the chat by hand since the last reset. */
function useReaderScrolled(contentElRef: React.RefObject<HTMLDivElement | null>): { readScrolled: () => boolean; resetScrolled: () => void } {
  const scrolled = useRef(false);
  const readScrolled = useCallback(() => scrolled.current, []);
  const resetScrolled = useCallback(() => { scrolled.current = false; }, []);
  useEffect(() => {
    // On the window, not the scroller: a chat that opens empty has no
    // scroller yet when this mounts.
    const inChat = (e: Event) => e.target instanceof Node && contentElRef.current?.parentElement?.contains(e.target) === true;
    const mark = (e: Event) => { if (inChat(e)) scrolled.current = true; };
    const onKey = (e: KeyboardEvent) => { if (SCROLL_KEYS.has(e.key)) mark(e); };
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchmove", mark, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchmove", mark);
      window.removeEventListener("keydown", onKey);
    };
  }, [contentElRef]);
  return { readScrolled, resetScrolled };
}
