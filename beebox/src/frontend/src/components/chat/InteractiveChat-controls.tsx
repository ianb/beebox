/**
 * Header chrome + control surfaces for InteractiveChat: the schedule
 * countdown pill, narration badge/icon, mute button, the companion view
 * panel, and the context link. These are presentational/self-contained —
 * they take props and emit callbacks, holding no chat-machine state of
 * their own.
 */

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useParams } from "@tanstack/react-router";
import { CloseButton } from "../ui/CloseButton";
import { ExternalIconLink } from "../ui/ExternalIconLink";
import { FileView } from "../FileView";
import { withBase } from "../../api";
import { cn } from "../../lib/cn";
import { displayName } from "../../lib/display-name";
import { prefersReducedMotion } from "../../lib/reduced-motion";
import type { ChatSchedule } from "@core/chat/schedules.js";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";
import type { SidecarTab } from "./sidecar-tabs";
import type { AddSelectionInput } from "../../lib/selection/position";
import type { ActivityKind } from "@core/chat/card-activity.js";

/**
 * Countdown pill showing time remaining for an active schedule.
 */
export function SchedulePill({ schedule, onCancel, onFired }: { schedule: ChatSchedule; onCancel: () => void; onFired?: () => void }) {
  const [remaining, setRemaining] = useState("");
  const firedRef = useRef(false);

  useEffect(() => {
    const update = () => {
      const ms = new Date(schedule.firesAt).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining("now");
        if (!firedRef.current) {
          firedRef.current = true;
          if (onFired !== undefined) onFired();
        }
        return;
      }
      const totalSec = Math.ceil(ms / 1000);
      if (totalSec >= 3600) {
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        setRemaining(m > 0 ? `${h}h ${m}m` : `${h}h`);
      } else if (totalSec >= 60) {
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        setRemaining(s > 0 ? `${m}m ${s}s` : `${m}m`);
      } else {
        setRemaining(`${totalSec}s`);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [schedule.firesAt, onFired]);

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/15 text-accent-dark text-xs font-medium border border-accent/30">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {schedule.label}: {remaining}
      {schedule.alarm ? " 🔔" : null}
      <button
        onClick={onCancel}
        className="ml-0.5 text-accent-dark/60 hover:text-accent-dark"
        title="Cancel schedule"
      >
        {"×"}
      </button>
    </span>
  );
}

/**
 * Mic-with-chat-bubble icon used in place of the standard handheld mic
 * when narration is enabled. Hints at "long talking" — the mic with a
 * speech bubble suggests an extended utterance rather than a one-shot
 * command.
 */
export function NarrationMicIcon({ className }: { className?: string }) {
  className = className ?? "w-5 h-5";
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {/* Chat bubble (top-right) */}
      <path
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 3h6a1 1 0 011 1v5a1 1 0 01-1 1h-3.5L14 12.5V3z"
      />
      {/* Mic body (bottom-left) */}
      <rect x="5" y="9" width="5" height="8" rx="2.5" strokeWidth={2} />
      <path
        strokeWidth={2}
        strokeLinecap="round"
        d="M3 14a4.5 4.5 0 009 0M7.5 19v2.5m-2 0h4"
      />
    </svg>
  );
}

/**
 * The pin. Filled when the tab is pinned, outline when the control is only
 * offering — the state and the offer must not look the same (principle 13).
 */
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z" />
      <path d="M12 15v5" />
    </svg>
  );
}

export type PanelTab = SidecarTab;

/**
 * Companion view panel shown alongside chat when one or more views are open.
 * Tabs are keyed by path: opening a file that's already open reactivates it
 * rather than duplicating a tab, and in-file link clicks open new tabs.
 */
/**
 * The tab strip. Its own component because it owns two behaviours the pane
 * around it does not: the element refs that let the active tab scroll itself
 * into view, and the pin control on each tab.
 */
function SidecarTabStrip({ tabs, activePath, onSelectTab, onCloseTab, onTogglePin }: {
  tabs: PanelTab[];
  activePath: string;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onTogglePin: (path: string) => void;
}) {
  // Tab elements by path, so the active one can be scrolled into view. With
  // more open documents than the strip can show, a newly opened tab landed
  // outside the visible range and the open read as a no-op — the highlight
  // existed, off-screen (2026-08-29).
  const tabRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pinned = tabs.filter((t) => t.pinned);
  const loose = tabs.filter((t) => !t.pinned);

  const revealActive = useCallback(() => {
    const el = tabRefs.current.get(activePath);
    if (el === undefined) return;
    const scroller = el.parentElement;
    if (scroller !== null) {
      const strip = scroller.getBoundingClientRect();
      const tab = el.getBoundingClientRect();
      // Already visible: leave it alone. Re-scrolling a visible tab is the
      // churn that makes a strip feel like it is fighting you.
      if (tab.left >= strip.left - 1 && tab.right <= strip.right + 1) return;
    }
    // `inline: "nearest"` scrolls the minimum needed; `block: "nearest"` keeps
    // this from scrolling any ancestor, since scrollIntoView walks every
    // scrollable ancestor and the chat shell is fixed.
    el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [activePath]);

  useEffect(() => {
    revealActive();
  }, [revealActive, tabs.length, pinned.length]);

  // The strip's width is not settled when a restored strip first renders — the
  // pane is still laying out, so every tab measures as visible and nothing
  // scrolls. Watching the scroller catches that, and a window resize with it.
  // Whichever scroller holds the active tab is the one to watch: pinned tabs
  // have their own, and it overflows too once several are pinned.
  useEffect(() => {
    const scroller = tabRefs.current.get(activePath)?.parentElement;
    if (scroller === undefined || scroller === null) return;
    const observer = new ResizeObserver(() => revealActive());
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [revealActive, activePath]);

  function renderTab(tab: PanelTab) {
    const isActive = tab.target.path === activePath;
    return (
      <div
        key={tab.target.path}
        role="none"
        ref={(el) => {
          if (el === null) tabRefs.current.delete(tab.target.path);
          else tabRefs.current.set(tab.target.path, el);
        }}
        className={cn(
          "group flex-shrink-0 flex items-center border-r border-warm-300 border-b-2",
          // A pinned tab is compact, the way a browser's is: it is there to hold
          // its place, not to be read. The full path is still in its title.
          tab.pinned ? "max-w-[7rem]" : "max-w-[14rem]",
          isActive ? "bg-white border-b-primary" : "border-b-transparent hover:bg-warm-100",
        )}
      >
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          onClick={() => onSelectTab(tab.target.path)}
          title={tab.target.path}
          className={cn(
            "flex-1 min-w-0 truncate text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            tab.pinned ? "text-xs pl-2 pr-0.5 py-1.5" : "text-sm pl-3 pr-1 py-1.5",
            isActive ? "text-warm-900 font-medium" : "text-warm-600",
          )}
        >
          {tab.pinned ? displayName(tab.target.path) : tab.label}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(tab.target.path);
          }}
          aria-label={tab.pinned ? `Unpin ${tab.label}` : `Pin ${tab.label}`}
          aria-pressed={tab.pinned}
          title={tab.pinned ? "Unpin tab" : "Pin tab"}
          className={cn(
            "flex-shrink-0 p-0.5 rounded hover:text-warm-800 hover:bg-warm-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            // Pinned: always shown, because it is the only thing that says the
            // tab is pinned. Unpinned: revealed on hover or keyboard focus, so
            // a row of tabs is not a row of icons.
            tab.pinned ? "text-primary" : "text-warm-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <PinIcon filled={tab.pinned} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCloseTab(tab.target.path);
          }}
          aria-label={`Close ${tab.label}`}
          title="Close tab"
          className={cn(
            "flex-shrink-0 mr-1 p-0.5 rounded text-warm-500 hover:text-warm-800 hover:bg-warm-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            // On a pinned tab the close button is the thing you did not ask
            // for; it stays out of the way until you reach for it.
            tab.pinned ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : "",
          )}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6l-12 12" />
          </svg>
        </button>
      </div>
    );
  }

  // Two scrollers, not one strip with sticky pins: a sticky tab occludes what
  // scrolls under it, and `scrollIntoView` cannot see occlusion — it would call
  // a tab parked behind the pins visible and never scroll to it. Separate
  // scrollers make "pinned tabs stay put" true by construction. The inner
  // wrappers carry `role="none"` so the tablist still owns the tabs themselves.
  return (
    <div id="bbx-panel-tabs" role="tablist" aria-label="Open files" className="flex-1 min-w-0 flex">
      {pinned.length > 0 ? (
        <div role="none" className="flex-shrink-0 max-w-[50%] flex overflow-x-auto border-r-2 border-warm-400 bg-warm-100">
          {pinned.map(renderTab)}
        </div>
      ) : null}
      <div role="none" className="flex-1 min-w-0 flex overflow-x-auto">
        {loose.map(renderTab)}
      </div>
    </div>
  );
}

function CompanionViewPanelInner({
  tabs,
  activePath,
  onSelectTab,
  onCloseTab,
  onTogglePin,
  onClosePanel,
  onNavigate,
  onUpdateTarget,
  onAddSelection,
  reportActivity,
}: {
  tabs: PanelTab[];
  activePath: string;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onTogglePin: (path: string) => void;
  onClosePanel: () => void;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  onUpdateTarget: (target: ViewTarget, hint?: NavigateHint) => void;
  onAddSelection?: (selection: AddSelectionInput) => void;
  /** Report user activity on the active card to the chat accumulator. */
  reportActivity: (kind: ActivityKind, detail?: string) => void;
}) {
  const { boxSlug } = useParams({ strict: false });
  // Tabs that have been activated at least once. We mount a tab's view on
  // first activation and keep it mounted thereafter, so each view retains its
  // own scroll position and interactive state while inactive (it's hidden, not
  // unmounted). Unopened tabs stay unrendered until first selected.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (mounted.has(activePath)) return;
    setMounted((prev) => new Set(prev).add(activePath));
  }, [activePath, mounted]);
  // Last reported scroll position per card path, quantized to the nearest tenth
  // (0.0–1.0). A scroll only reports when it crosses into a new tenth, so the
  // agent sees "they read to ~0.6" instead of either nothing or an event storm.
  const lastScrollTenthRef = useRef<Map<string, number>>(new Map());
  const reportScroll = useCallback(
    (path: string, el: HTMLElement) => {
      const max = el.scrollHeight - el.clientHeight;
      const tenth = max > 0 ? Math.round((el.scrollTop / max) * 10) / 10 : 0;
      if (lastScrollTenthRef.current.get(path) === tenth) return;
      lastScrollTenthRef.current.set(path, tenth);
      reportActivity("scrolled", tenth.toFixed(1));
    },
    [reportActivity],
  );
  const active = tabs.find((t) => t.target.path === activePath);
  if (!active) return null;
  const browseHref = withBase(`/${boxSlug}/browse/${active.target.path}`);
  return (
    <div className="h-[40vh] md:h-full md:w-1/2 flex-shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-warm-300 bg-white">
      <div className="flex-shrink-0 flex items-stretch border-b border-warm-300 bg-warm-50 min-w-0">
        <SidecarTabStrip tabs={tabs} activePath={activePath} onSelectTab={onSelectTab} onCloseTab={onCloseTab} onTogglePin={onTogglePin} />
        <div className="flex-shrink-0 flex items-center gap-1 px-2 border-l border-warm-300">
          <ExternalIconLink id="bbx-panel-open-browse" href={browseHref} label="Open in browse view (new tab)" size="sm" />
          <CloseButton id="bbx-panel-close" onClick={onClosePanel} label="Close companion view" size="sm" />
        </div>
      </div>
      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => {
          const isActive = tab.target.path === activePath;
          // Skip tabs that have never been activated so they stay unrendered
          // until first opened. The active tab always renders (the mounted set
          // catches up via effect on the first render after activation).
          if (!isActive && !mounted.has(tab.target.path)) return null;
          return (
            <div
              key={tab.target.path}
              role="tabpanel"
              aria-hidden={!isActive}
              // The rendered card is user content, out of the `bbx chat ui` walk
              // (lib/ui-scan/scan.ts, SCAN_BOUNDARY_ATTRIBUTE). The pane's own
              // chrome — the tab strip, the close button — is above this and
              // stays scannable.
              data-bbx-scan="exclude"
              // tabIndex 0: a scrolling tabpanel must be keyboard-focusable
              // (both the tabpanel ARIA pattern and axe's
              // scrollable-region-focusable) — the fixed shell's window never
              // scrolls, so keys only reach a container that can take focus.
              tabIndex={0}
              className={cn("absolute inset-0 overflow-auto", !isActive && "hidden")}
              // Scrolling the active card reports a quantized read position
              // (nearest tenth); reportScroll de-dupes so a scroll only fires
              // when it crosses a tenth. Only the visible tab scrolls.
              onScroll={isActive ? (e) => reportScroll(tab.target.path, e.currentTarget) : undefined}
            >
              <FileView
                path={tab.target.path}
                mode="companion"
                rendererName={tab.target.viewer}
                params={tab.target.params}
                viewState={tab.target.viewState}
                onViewStateChange={(next) => onUpdateTarget({ ...tab.target, viewState: next }, { label: tab.label })}
                onNavigate={onNavigate}
                onAddSelection={onAddSelection}
                reportActivity={reportActivity}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Memoized so a chat-machine snapshot change (message submit, streaming token,
 * status flip) re-renders the message subtree WITHOUT re-rendering the open
 * companion card beside it — the pane's inputs (tabs / activePath) don't change
 * on a send. Memo only holds if every prop is referentially stable across a
 * submit; callers pass `useCallback`-stable handlers (see InteractiveChat-view).
 */
export const CompanionViewPanel = memo(CompanionViewPanelInner);
