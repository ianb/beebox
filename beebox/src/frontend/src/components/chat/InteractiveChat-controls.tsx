/**
 * Header chrome + control surfaces for InteractiveChat: the schedule
 * countdown pill, narration badge/icon, mute button, the companion view
 * panel, and the context link. These are presentational/self-contained —
 * they take props and emit callbacks, holding no chat-machine state of
 * their own.
 */

import { useState, useEffect, useRef } from "react";

import type { ChatSchedule } from "@core/chat/schedules.js";
import type { SidecarTab } from "./sidecar-tabs";

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

export type PanelTab = SidecarTab;
