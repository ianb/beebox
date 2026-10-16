/**
 * The DOM half of the capture anchor: reads the list and the scroller, and
 * asks `capture-anchor.ts` what to put at the top. Split out of `messages.tsx`
 * to keep that file within its line budget.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { parseDeliveredUserMessageParts } from "@shared/delivered-user-message";
import type { MessageGroup } from "../../ChatMessages/view";
import type { CaptureBubbleModel } from "../../capture-bubble";
import { noteBubbleScrollTop, startCaptureWait, stepCaptureWait, type CaptureAnchorView, type CaptureAnchorWait } from "./capture-anchor";

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
    // The content wrapper's parent is the scroller (see the render below).
    const scroller = content?.parentElement;
    if (wait.current === null || !content || !scroller) return;
    const now: CaptureAnchorView = { newestCapture, bubbleIds, scrollTop: scroller.scrollTop };
    const { wait: next, step } = stepCaptureWait(wait.current, now);
    wait.current = next;
    if (step.anchor === "user") {
      const users = content.querySelectorAll("[data-role=\"user\"]");
      anchorToTop(users[users.length - 1] ?? null);
    } else if (step.anchor === "bubble") {
      // Bubbles render in model order after the transcript, so the DOM index matches.
      const bubble = content.querySelectorAll("[data-role=\"captureBubble\"]")[step.index];
      if (bubble === undefined || next === null) return;
      // Where the anchor will settle: the bubble's top at the scroller's top.
      const target = scroller.scrollTop + bubble.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      wait.current = noteBubbleScrollTop(next, target);
      anchorToTop(bubble);
    }
  }, [captureSignal, sendSignal, newestCapture, captureBubbles, contentElRef, anchorToTop]);
}
