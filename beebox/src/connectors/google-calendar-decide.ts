/**
 * Google Calendar sync — the conflict/precedence policy as one pure function.
 *
 * The connector reconciles a box's local `.ics` files against Google Calendar
 * in both directions. Historically the "who wins" decision was expressed inline
 * at three sites (pull reconcile, remote-cancellation, local delete-marker),
 * each re-deriving the precedence from booleans. This module hoists that policy
 * into a single pure `decideCalendarSync` over a discriminated {@link SyncSituation},
 * so the vocabulary is defined once, is exhaustiveness-checked, and is testable
 * without touching fs or the Google API. The IO sites stay thin adapters that
 * gather the booleans, call this, and act on the {@link SyncDecision}.
 *
 * ## Conflict policy (the protocol)
 *
 * "Local edit" means the on-disk `.ics` content hash differs from the hash the
 * connector recorded at its last write (a legacy state entry with no recorded
 * hash counts as *not* locally edited — the connector can't prove a local edit,
 * so it defers to remote). "Remote changed" means Google's `updated` timestamp
 * moved since the last pull.
 *
 * - A **new** remote event (no tracked local file) → `remote-wins`: write it
 *   down. (Accounting still distinguishes created-vs-updated at the call site;
 *   the *decision* — the local file mirrors the remote — is the same.)
 * - **No local edit** → `remote-wins`: refresh the local file from Google.
 * - **Local edit, remote unchanged** → `local-wins`: push the edit to Google.
 * - **Local edit AND remote changed** → `remote-wins`: a true conflict; remote
 *   is authoritative, the local edit is discarded (with a note). This is the
 *   single asymmetric rule — the box never silently clobbers a remote change.
 * - A remote **cancellation** of a tracked event → `delete`; of an untracked
 *   event → `noop`.
 * - A local **delete-marker** (`X-BBX-DELETE`) → `delete`, unless the per-sync
 *   delete cap is reached or the state has no calendar id for the event → `noop`.
 */

import { assertNever } from "../lib/invariant.js";

/** What the sync should do with one event, in either direction. */
export type SyncDecision =
  | { kind: "remote-wins" }
  | { kind: "local-wins" }
  | { kind: "delete" }
  | { kind: "noop"; reason: string };

/** The situation a sync decision is made in, tagged by which pass raised it. */
export type SyncSituation =
  /** Pull pass: a non-cancelled, in-window remote event. `tracked` = a local
   *  file already exists for it. `localEdited`/`remoteChanged` per the header. */
  | { source: "remote-event"; tracked: boolean; localEdited: boolean; remoteChanged: boolean }
  /** Pull pass: the remote event is cancelled. `tracked` = we hold a local file. */
  | { source: "remote-cancelled"; tracked: boolean }
  /** Push pass: a tracked local file carries an `X-BBX-DELETE` marker. */
  | { source: "local-delete-marker"; hasCalendarId: boolean; underDeleteCap: boolean };

/**
 * The single source of the sync precedence policy. Pure: no IO, no clock.
 * Callers gather the booleans from disk/state and dispatch on the result.
 */
export function decideCalendarSync(situation: SyncSituation): SyncDecision {
  switch (situation.source) {
    case "remote-event": {
      if (!situation.tracked) return { kind: "remote-wins" };
      if (!situation.localEdited) return { kind: "remote-wins" };
      // Local edit present: push it only if the remote hasn't also moved.
      if (situation.remoteChanged) return { kind: "remote-wins" };
      return { kind: "local-wins" };
    }
    case "remote-cancelled":
      return situation.tracked
        ? { kind: "delete" }
        : { kind: "noop", reason: "untracked cancelled event" };
    case "local-delete-marker": {
      if (!situation.underDeleteCap) return { kind: "noop", reason: "reached per-sync delete cap" };
      if (!situation.hasCalendarId) return { kind: "noop", reason: "no calendar ID in state" };
      return { kind: "delete" };
    }
    default:
      return assertNever(situation);
  }
}
