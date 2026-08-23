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
 * Inside the native shell the same link points at something the DOM has never
 * heard of: on iOS the composer, mic and capture are SwiftUI, so a pointer at
 * one resolves to nothing while the control is plainly on screen. So a failed
 * DOM resolve there is not a verdict — the pointer stays live and, on click,
 * hands the address to the shell (`chat/native-control-point.ts`), which draws
 * the ring itself or refuses with a reason this component then shows. Only a
 * malformed address is broken on sight on that surface, because that one is
 * knowably wrong without asking anybody.
 *
 * The action itself is `lib/ui-scan/actions.ts`; the ring is
 * `ui/ControlRing.tsx`. What lives here is the resolution lifecycle and the two
 * renderings.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrokenLink } from "./ui/BrokenLink";
import { ControlRing } from "./ui/ControlRing";
import { isNativeShell } from "./chat/native-post";
import { windowNativeControlBridge } from "./chat/native-command-bridge";
import { NATIVE_POINT_TIMEOUT_MS, requestNativePointAtControl } from "./chat/native-control-point";
import { performControlAction, type ControlTarget } from "../lib/ui-scan/actions";
import { isRectInViewport } from "../lib/ui-scan/ring";
import { isElementVisible } from "../lib/ui-scan/live-dom";
import { resolveVisibleControl, type ResolveFailure } from "../lib/ui-scan/resolve";
import type { ControlAction } from "../lib/ui-scan/types";

/** How long a burst of DOM mutations settles before the pointer re-resolves. */
const RESOLVE_DEBOUNCE_MS = 250;

/**
 * How long a native refusal keeps the pointer visibly broken before it becomes
 * live again.
 *
 * Native refusals are *not* verdicts the way a malformed address is. "No control
 * on screen right now" is true of the mic the moment the composer swaps it for
 * the send button, and false again a keystroke later — and none of that touches
 * the DOM, so the `MutationObserver` cannot see it and the pointer has no way to
 * re-ask except by being tapped. Caching the refusal forever would kill a link
 * that is fine again; discarding it instantly would make the tap that produced
 * it look like nothing happened. So it is shown, and it expires.
 */
const NATIVE_REFUSAL_TTL_MS = 15_000;

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

/**
 * What this pointer is right now.
 *
 * `native` is a real third state, not a flavour of `ok`: the control is not in
 * this document and only the shell can say whether it exists, so the pointer
 * renders live, defers the question to click time, and becomes `broken` with
 * the shell's own words if the answer is no.
 */
type PointerStatus = { kind: "ok" } | { kind: "native" } | { kind: "broken"; reason: string };

/** Why this address does not name a live control in *this document*. */
function brokenReason(id: string, failure: ResolveFailure): string {
  switch (failure) {
    case "bad-id":
      return `Not a control address: "${id}"`;
    case "not-found":
      return `No control "${id}" on this screen`;
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

/** What the live document says about this address, with no shell involved. */
function domStatusOf(id: string): { kind: "ok" } | { kind: "broken"; failure: ResolveFailure } {
  if (typeof document === "undefined") return { kind: "broken", failure: "not-found" };
  const resolved = resolveVisibleControl(id, liveLookup);
  return resolved.ok ? { kind: "ok" } : { kind: "broken", failure: resolved.error };
}

/**
 * The DOM verdict plus what the shell has already said, resolved into what the
 * pointer renders.
 *
 * `nativeReason` outranks the DOM's "not found" because it is a *later* and
 * better-informed answer to the same question: the shell was asked about this
 * exact address and said no. It is cleared when the address changes, so a
 * re-rendered pointer at a different control asks again.
 */
function effectiveStatus(
  id: string,
  { dom, nativeReason }: { dom: ReturnType<typeof domStatusOf>; nativeReason: string | null },
): PointerStatus {
  if (dom.kind === "ok") return { kind: "ok" };
  // A malformed address is wrong on every surface; a well-formed one the DOM
  // does not hold may still be the shell's own chrome, and only the shell knows.
  if (dom.failure === "bad-id" || !isNativeShell()) {
    return { kind: "broken", reason: brokenReason(id, dom.failure) };
  }
  return nativeReason === null ? { kind: "native" } : { kind: "broken", reason: nativeReason };
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
  const [dom, setDom] = useState(() => domStatusOf(id));
  /** The shell's most recent refusal for this address, until it expires. */
  const [nativeReason, setNativeReason] = useState<string | null>(null);
  /** True while a `point-at-control` is in flight, so a second tap does not stack. */
  const [awaitingNative, setAwaitingNative] = useState(false);
  const [degraded, setDegraded] = useState<string | null>(null);
  // `seq` restarts the ring when the same control is pointed at twice: remounting
  // ControlRing is what resets its timer.
  const [ring, setRing] = useState<{ element: HTMLElement; seq: number } | null>(null);
  /**
   * Which request's answer this component still wants.
   *
   * A `point-at-control` answer can arrive after the pointer has been unmounted
   * (the turn re-rendered) or after its props changed — React keeps a component
   * instance across a re-render at the same position, so the same instance can
   * outlive the address it asked about. Applying that answer would record a
   * refusal against a control nobody asked about. The generation is bumped on
   * unmount and on every `id`/`action` change, and a completion from an older
   * generation is dropped.
   */
  const requestGeneration = useRef(0);

  useEffect(() => {
    return () => {
      requestGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    // A different address (or a different action on the same one) is a different
    // question: drop the previous answer rather than carrying it over.
    requestGeneration.current += 1;
    setDom(domStatusOf(id));
    setNativeReason(null);
    setAwaitingNative(false);
    setDegraded(null);
    let pending: ReturnType<typeof setTimeout> | null = null;
    // One observer per pointer over the whole document, coalesced: a pointer is
    // rare (one per agent sentence) and the callback does nothing but arm a
    // timer, so the per-mutation cost is a boolean check. The re-resolve itself
    // is one `getElementById` per settled burst.
    const observer = new MutationObserver(() => {
      if (pending !== null) return;
      pending = setTimeout(() => {
        pending = null;
        setDom(domStatusOf(id));
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
  }, [id, action]);

  // A refusal is the last thing the shell said, not a permanent fact about the
  // control, so it stops speaking for the pointer after a while and the link
  // goes live again. Re-armed by each new refusal, cleared on unmount.
  useEffect(() => {
    if (nativeReason === null) return;
    const timer = setTimeout(() => setNativeReason(null), NATIVE_REFUSAL_TTL_MS);
    return () => clearTimeout(timer);
  }, [nativeReason]);

  const status = effectiveStatus(id, { dom, nativeReason });

  if (status.kind === "broken") {
    return <BrokenLink title={status.reason}>{children}</BrokenLink>;
  }

  /**
   * Hand the address to the shell. Success needs no follow-up — the ring is
   * already on the phone's own view — and every failure, refusal or silence
   * alike, turns this pointer broken in place with the shell's own words.
   */
  const pointNatively = (): void => {
    if (awaitingNative) return;
    const generation = requestGeneration.current;
    setAwaitingNative(true);
    void requestNativePointAtControl(windowNativeControlBridge(), {
      commandId: crypto.randomUUID(),
      controlId: id,
      action,
      timeoutMs: NATIVE_POINT_TIMEOUT_MS,
    })
      .then((outcome) => {
        if (requestGeneration.current !== generation) return;
        setAwaitingNative(false);
        if (!outcome.ok) setNativeReason(outcome.reason);
      })
      .catch((e: unknown) => {
        // `requestNativePointAtControl` never rejects; a throw here is the
        // bridge itself failing, which is still a user-visible dead tap.
        const reason = e instanceof Error ? e.message : String(e);
        console.warn(`[control-pointer] native point failed: ${reason}`);
        if (requestGeneration.current !== generation) return;
        setAwaitingNative(false);
        setNativeReason(reason);
      });
  };

  const handleClick = () => {
    if (status.kind === "native") {
      pointNatively();
      return;
    }
    const resolved = resolveVisibleControl(id, liveLookup);
    if (!resolved.ok) {
      // Resolved a frame ago, gone (or hidden) now. Flip in place; never no-op
      // silently — or, in the shell, ask the shell before declaring it dead.
      setDom({ kind: "broken", failure: resolved.error });
      setRing(null);
      if (resolved.error !== "bad-id" && isNativeShell()) pointNatively();
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
    status.kind === "native" ? "this control belongs to the app around the page, which draws the pointer itself" : null,
    degraded,
  ].filter((note) => note !== null);
  const tooltip = [tooltipFor({ id, action }), ...notes].join(" — ");

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={tooltip}
        aria-busy={awaitingNative}
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
