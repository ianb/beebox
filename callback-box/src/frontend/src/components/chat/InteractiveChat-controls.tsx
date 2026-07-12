/**
 * Header chrome + control surfaces for InteractiveChat: the schedule
 * countdown pill, narration badge/icon, mute and new-session buttons, the
 * debug dropdown menu, the companion view panel, and the context link.
 * These are presentational/self-contained — they take props and emit
 * callbacks, holding no chat-machine state of their own.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "@tanstack/react-router";
import { CloseButton } from "../ui/CloseButton";
import { ExternalIconLink } from "../ui/ExternalIconLink";
import { FileView } from "../FileView";
import { withBase } from "../../api";
import { cn } from "../../lib/cn";
import type { ChatSchedule } from "@core/chat/schedules.js";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";
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
 * Header toggle for narration mode. Always visible:
 *
 * - **off:** a dim outline pill, the whole pill clickable to turn narration on.
 * - **on:** a filled pill that shows a "transcribing…" sub-label while the HQ
 *   pass is in flight after a send-message checkpoint (so the user can see the
 *   agent isn't ignoring them — it's waiting on the round-trip to the HQ
 *   transcription service), plus an "✕" affordance to turn narration back off.
 */
export function NarrationStatusBadge({
  enabled,
  hqInFlight,
  onToggle,
}: {
  enabled: boolean;
  hqInFlight: boolean;
  onToggle: () => void;
}) {
  if (!enabled) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Turn on narration mode"
        aria-pressed={false}
        title="Turn on narration mode"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-white/40 text-white/70 text-xs font-medium hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
      >
        <span aria-hidden>🎙️</span>
        <span>narration</span>
      </button>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-white/20 text-white text-xs font-medium"
      title="Narration mode is on — silent responses, structured output, HQ transcription on send"
    >
      <span aria-hidden>🎙️</span>
      <span>narration</span>
      {hqInFlight ? <span className="opacity-80">· transcribing…</span> : null}
      <button
        type="button"
        onClick={onToggle}
        aria-label="Turn off narration mode"
        aria-pressed
        title="Turn off narration"
        className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-white/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

export function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
      title={muted ? "Unmute speech" : "Mute speech"}
      aria-label={muted ? "Unmute speech" : "Mute speech"}
      aria-pressed={muted}
    >
      {muted ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5 6 9H3v6h3l5 4V5zM17 9l4 6m0-6-4 6" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5 6 9H3v6h3l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M18.36 5.64a9 9 0 0 1 0 12.72" />
        </svg>
      )}
    </button>
  );
}

export function NewSessionButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
      title="New Session"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    </button>
  );
}

export interface PanelTab {
  target: ViewTarget;
  label: string;
}

/**
 * Companion view panel shown alongside chat when one or more views are open.
 * Tabs are keyed by path: opening a file that's already open reactivates it
 * rather than duplicating a tab, and in-file link clicks open new tabs.
 */
export function CompanionViewPanel({
  tabs,
  activePath,
  onSelectTab,
  onCloseTab,
  onClosePanel,
  onNavigate,
  onAddSelection,
  reportActivity,
}: {
  tabs: PanelTab[];
  activePath: string;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onClosePanel: () => void;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
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
        <div role="tablist" aria-label="Open files" className="flex-1 min-w-0 flex overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.target.path === activePath;
            return (
              <div
                key={tab.target.path}
                className={cn(
                  "flex-shrink-0 max-w-[14rem] flex items-center border-r border-warm-300 border-b-2",
                  isActive
                    ? "bg-white border-b-primary"
                    : "border-b-transparent hover:bg-warm-100",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectTab(tab.target.path)}
                  title={tab.target.path}
                  className={cn(
                    "flex-1 min-w-0 truncate text-left text-sm pl-3 pr-1 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    isActive ? "text-warm-900 font-medium" : "text-warm-600",
                  )}
                >
                  {tab.label}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.target.path);
                  }}
                  aria-label={`Close ${tab.label}`}
                  title="Close tab"
                  className="flex-shrink-0 mr-1 p-0.5 rounded text-warm-500 hover:text-warm-800 hover:bg-warm-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6l-12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1 px-2 border-l border-warm-300">
          <ExternalIconLink href={browseHref} label="Open in browse view (new tab)" size="sm" />
          <CloseButton onClick={onClosePanel} label="Close companion view" size="sm" />
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
 * Small "Context: <dir>" link in the chat header for chats that were
 * started from a landmark.
 */
export function ChatContextLink({ dir, boxSlug }: { dir: string | null; boxSlug: string }) {
  if (!dir) return null;
  return (
    <a
      href={withBase(`/${boxSlug}/browse/${dir}`)}
      className="ml-3 text-xs text-white/80 hover:text-white truncate"
      title={`Context: ${dir}/`}
    >
      {dir}/
    </a>
  );
}
