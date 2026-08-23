/**
 * A `control:` link: an inline reference that points at a control in the running
 * interface instead of navigating to content.
 *
 * Stateful on purpose. A path link is broken the same way forever, so
 * `Markdown.tsx` can classify it once at render; a pointer's validity is *live*
 * state — the same link is fine while the chat is open and dead after the user
 * navigates away. So this component resolves on mount, re-resolves on a debounced
 * `MutationObserver` (childList plus `id` attributes), and shows the `BrokenLink`
 * treatment the moment its control leaves the document. A pointer that only
 * revealed its brokenness on click would be exactly the silent failure that
 * treatment exists to avoid — and a click that fails at the last moment (resolved
 * a frame ago, gone now) flips this component to broken in place rather than
 * navigating, toasting, or quietly doing nothing.
 *
 * The action itself is `lib/ui-scan/actions.ts`; the ring is
 * `ui/ControlRing.tsx`. What lives here is the resolution lifecycle and the two
 * renderings.
 */

import { useEffect, useState, type ReactNode } from "react";
import { BrokenLink } from "./ui/BrokenLink";
import { ControlRing } from "./ui/ControlRing";
import { isNativeShell } from "./chat/native-post";
import { performControlAction, type ControlTarget } from "../lib/ui-scan/actions";
import { isRectInViewport } from "../lib/ui-scan/ring";
import { isElementVisible } from "../lib/ui-scan/live-dom";
import { resolveVisibleControl, type ResolveFailure } from "../lib/ui-scan/resolve";
import type { ControlAction } from "../lib/ui-scan/types";

/** How long a burst of DOM mutations settles before the pointer re-resolves. */
const RESOLVE_DEBOUNCE_MS = 250;

export interface ControlPointerProps {
  /** The `cb-` address the pointer names. */
  id: string;
  action: ControlAction;
  /** Agent-authored line shown beside the link, or null. */
  description: string | null;
  /** An `action` value that was not understood, so this pointer degraded to `point`. */
  unknownAction: string | null;
  children?: ReactNode;
}

type PointerStatus = { kind: "ok" } | { kind: "broken"; reason: string };

/**
 * Why this address does not name a live control.
 *
 * The native case is the seam for Track 5: inside the iOS/Android shell the
 * composer is native chrome with no DOM element behind it, so "not found" would
 * be a wrong answer rather than a missing one. Until the bridge can point at a
 * native control, say which of the two it is.
 */
function brokenReason(id: string, failure: ResolveFailure): string {
  switch (failure) {
    case "bad-id":
      return `Not a control address: "${id}"`;
    case "not-found":
      return isNativeShell()
        ? `native control — not yet supported (${id})`
        : `No control "${id}" on this screen`;
    case "hidden":
      return `This control is not currently visible (${id})`;
  }
}

/**
 * The live document, plus the visibility rule the scan walks with. Both halves
 * of the feature must agree about what is on screen: at a phone width the
 * desktop composer row is still mounted and `display:none`, so `cb-composer-send`
 * resolves to an element the user cannot see — a ring around nothing, and a
 * `reveal` that would click a hidden button.
 */
const liveLookup = {
  getElementById: (id: string): HTMLElement | null => document.getElementById(id),
  isVisible: isElementVisible,
};

function currentStatus(id: string): PointerStatus {
  if (typeof document === "undefined") return { kind: "broken", reason: `No control "${id}" on this screen` };
  const resolved = resolveVisibleControl(id, liveLookup);
  return resolved.ok ? { kind: "ok" } : { kind: "broken", reason: brokenReason(id, resolved.error) };
}

/** The live-element implementation of what an action needs. */
function liveTarget(element: HTMLElement): ControlTarget {
  const rect = element.getBoundingClientRect();
  return {
    revealable: element.hasAttribute("data-cb-reveal"),
    inView: isRectInViewport(rect, { width: window.innerWidth, height: window.innerHeight }),
    scrollIntoView: () => {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    },
    focus: () => {
      element.focus();
    },
    click: () => {
      element.click();
    },
  };
}

function tooltipFor({ id, action }: { id: string; action: ControlAction }): string {
  switch (action) {
    case "point":
      return `Points at this control on screen (${id})`;
    case "focus":
      return `Points at and focuses this control (${id})`;
    case "reveal":
      return `Opens this control (${id})`;
  }
}

/** A crosshair: this link acts on the interface rather than navigating. */
function PointerIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="7" />
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4" strokeLinecap="round" />
    </svg>
  );
}

export function ControlPointer({ id, action, description, unknownAction, children }: ControlPointerProps) {
  const [status, setStatus] = useState<PointerStatus>(() => currentStatus(id));
  const [degraded, setDegraded] = useState<string | null>(null);
  // `seq` restarts the ring when the same control is pointed at twice: remounting
  // ControlRing is what resets its timer.
  const [ring, setRing] = useState<{ element: HTMLElement; seq: number } | null>(null);

  useEffect(() => {
    setStatus(currentStatus(id));
    let pending: ReturnType<typeof setTimeout> | null = null;
    // One observer per pointer over the whole document, coalesced: a pointer is
    // rare (one per agent sentence) and the callback does nothing but arm a
    // timer, so the per-mutation cost is a boolean check. The re-resolve itself
    // is one `getElementById` per settled burst.
    const observer = new MutationObserver(() => {
      if (pending !== null) return;
      pending = setTimeout(() => {
        pending = null;
        setStatus(currentStatus(id));
      }, RESOLVE_DEBOUNCE_MS);
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      // Ids only. A control that becomes hidden without the tree changing (a
      // viewport crossing a breakpoint) is not caught here — the click-time
      // re-resolve below flips it to broken in place rather than acting on it.
      attributeFilter: ["id"],
    });
    return () => {
      observer.disconnect();
      if (pending !== null) clearTimeout(pending);
    };
  }, [id]);

  if (status.kind === "broken") {
    return <BrokenLink title={status.reason}>{children}</BrokenLink>;
  }

  const handleClick = () => {
    const resolved = resolveVisibleControl(id, liveLookup);
    if (!resolved.ok) {
      // Resolved a frame ago, gone (or hidden) now. Flip in place; never no-op
      // silently.
      setStatus({ kind: "broken", reason: brokenReason(id, resolved.error) });
      setRing(null);
      return;
    }
    const outcome = performControlAction(action, liveTarget(resolved.value));
    setDegraded(outcome.degraded);
    setRing((previous) => ({ element: resolved.value, seq: (previous?.seq ?? 0) + 1 }));
  };

  const notes = [
    unknownAction === null
      ? null
      : `the requested action "${unknownAction}" is not one this app knows, so it points instead`,
    degraded,
  ].filter((note) => note !== null);
  const tooltip = [tooltipFor({ id, action }), ...notes].join(" — ");

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={tooltip}
        className="inline-flex items-baseline gap-1 text-primary underline hover:text-primary-dark"
      >
        <PointerIcon />
        {children}
      </button>
      {description === null ? null : <span className="text-warm-600"> — {description}</span>}
      {ring === null ? null : (
        <ControlRing key={ring.seq} target={ring.element} onDone={() => setRing(null)} />
      )}
    </>
  );
}
