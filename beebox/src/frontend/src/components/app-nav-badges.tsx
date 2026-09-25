/**
 * The app bar's attention badges — pending questions, the plate, and console
 * errors — drawn as segments of ONE pill rather than three.
 *
 * They were three separate `rounded-full` chips with `gap-2` between them,
 * which spent 52px of a 375px bar on padding and gaps to carry about 40px of
 * icons and digits. The bar's only flexible member is the place pill, so every
 * one of those pixels came out of the label that says where you are, and at
 * phone width it reached zero
 * (`issues/bugs/2026-09-15-mobile-app-bar-crowds-place-label.md`). Sharing one
 * container returns about 32px without hiding a count or putting one behind a
 * tap.
 *
 * Each segment stays its own control with its own destination and its own
 * accessible name: two links and a button, not one widget with a menu. The
 * pill is a visual container only — it takes no role, and a screen reader
 * still meets three separate things.
 *
 * Zero renders nothing, per badge and for the group: a first-run bar shows no
 * empty container.
 */

import { Link } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { useErrorCount, clearErrorCount, hasDebugLogBeenOpened } from "./DebugLog";

/** A speech bubble carrying a question mark — asked, not yet answered. */
function QuestionIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M2.5 4.25A1.75 1.75 0 0 1 4.25 2.5h7.5a1.75 1.75 0 0 1 1.75 1.75v5a1.75 1.75 0 0 1-1.75 1.75H7l-3 2.5v-2.5h-.25A1.25 1.25 0 0 1 2.5 9.75Z" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M6.4 5.9a1.6 1.6 0 0 1 3.1.55c0 1.05-1.55 1.3-1.55 2.3" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="7.95" cy="10.4" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The plate's rim, seen from above — the badge's mark instead of a glyph. */
function PlateIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="3.25" strokeWidth="1.25" />
    </svg>
  );
}

/** Hairline between two segments — the gap the separate pills used to leave. */
function SegmentDivider() {
  return <span aria-hidden="true" className="w-px self-stretch my-1 bg-white/25 shrink-0" />;
}

// The container clips with `overflow-hidden`, so a focus ring drawn outside
// the segment would be cut off — it has to be inset, the same reason the chips
// in the shared chip pill switched to `ring-inset`.
const SEGMENT = "flex items-center gap-1 px-1 sm:px-1.5 py-0.5 hover:bg-white/15 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40";

export function AttentionBadges({ base, pendingQuestions, onPlateTodos, escalatedTodos, onToggleDebugLog }: {
  base: string;
  pendingQuestions: number;
  onPlateTodos: number;
  /** Of `onPlateTodos`, how many are past due — draws a small dot on the plate segment. */
  escalatedTodos: number;
  onToggleDebugLog: () => void;
}) {
  const errorCount = useErrorCount();
  // A developer affordance: the count accumulates from the first error, but the
  // badge stays hidden until the person has opened the debug log at least once
  // in this browser, so a first-run screen never leads with one. The profile
  // menu's "Debug Log" item is the always-reachable path in.
  const showErrors = errorCount > 0 && hasDebugLogBeenOpened();

  const segments = [
    pendingQuestions > 0 ? (
      <Link
        key="questions"
        id="bbx-nav-questions"
        to={href(`${base}/questions`)}
        className={SEGMENT}
        title={`${pendingQuestions} question${pendingQuestions !== 1 ? "s" : ""} waiting for you`}
        aria-label={`${pendingQuestions} question${pendingQuestions !== 1 ? "s" : ""} waiting for you`}
      >
        <QuestionIcon />
        {pendingQuestions}
      </Link>
    ) : null,
    onPlateTodos > 0 ? (
      <Link
        key="plate"
        id="bbx-nav-todo"
        to={href(`${base}/browse/_content/plate.todo-view.card`)}
        className={`${SEGMENT} relative`}
        title={
          escalatedTodos > 0
            ? `${onPlateTodos} todo${onPlateTodos !== 1 ? "s" : ""} on the plate, ${escalatedTodos} escalated`
            : `${onPlateTodos} todo${onPlateTodos !== 1 ? "s" : ""} on the plate`
        }
        aria-label={
          escalatedTodos > 0
            ? `${onPlateTodos} todo${onPlateTodos !== 1 ? "s" : ""} on the plate, ${escalatedTodos} escalated`
            : `${onPlateTodos} todo${onPlateTodos !== 1 ? "s" : ""} on the plate`
        }
      >
        <PlateIcon />
        {onPlateTodos}
        {/* A dot, not a second number: the badge stays one number (boxholder:
            "Badge is fine") and the dot is what says some of it is overdue. */}
        {escalatedTodos > 0 ? (
          <span aria-hidden="true" className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-danger" />
        ) : null}
      </Link>
    ) : null,
    showErrors ? (
      <button
        key="errors"
        type="button"
        id="bbx-nav-errors"
        onClick={() => { clearErrorCount(); onToggleDebugLog(); }}
        // The one segment that keeps a background of its own: an error count is
        // not the same kind of waiting as a question or a todo, and the red has
        // to survive being pulled into a shared container.
        className={`${SEGMENT} bg-danger/80 hover:bg-danger-dark`}
        title={`${errorCount} error${errorCount !== 1 ? "s" : ""}`}
        aria-label={`Open debug log (${errorCount} error${errorCount !== 1 ? "s" : ""})`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-white" />
        {errorCount}
      </button>
    ) : null,
  ].filter((segment) => segment !== null);

  if (segments.length === 0) return null;
  return (
    <div className="flex items-stretch text-xs text-white bg-white/20 rounded-full overflow-hidden shrink-0">
      {segments.map((segment, index) => (
        // The key is the segment's own; this fragment only carries the divider
        // that precedes it, and the segment list is built in a fixed order.
        <div key={segment.key} className="flex items-stretch">
          {index === 0 ? null : <SegmentDivider />}
          {segment}
        </div>
      ))}
    </div>
  );
}
