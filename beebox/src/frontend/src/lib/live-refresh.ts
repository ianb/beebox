/**
 * Event matchers for `useLiveRefresh`'s `when`: which bus events mean a view's
 * data may have changed. Each caller composes its own predicate from these;
 * there is no shared registry of what a view depends on.
 */

import type { BusEventName } from "@backend/trpc/routers/events.js";
import type { RealtimeEvent } from "../hooks/useBusSubscription";
import { busEventData } from "./bus-events";
import { fileChangeAffectsPath } from "./moved-card-recovery";

export type LiveRefreshMatcher = (event: RealtimeEvent) => boolean;

/**
 * A `file-change` at `path`, compared box-relative, or a rename of a directory
 * that contains it (`fileChangeAffectsPath`).
 */
export function fileChangeAt(path: string): LiveRefreshMatcher {
  return (event) => {
    const change = busEventData(event, "file-change");
    return change !== null && fileChangeAffectsPath(change, path);
  };
}

/** Any `file-change`, anywhere in the box. */
export const anyFileChange: LiveRefreshMatcher = (event) => event.event === "file-change";

/** Any event whose name is one of `names`. */
export function oneOf(...names: BusEventName[]): LiveRefreshMatcher {
  const set = new Set<string>(names);
  return (event) => set.has(event.event);
}
