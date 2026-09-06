/**
 * The sidecar's tab state: which documents are open beside chat, which one is
 * showing, and which are pinned.
 *
 * A reducer rather than a bag of setState calls, because three of the decisions
 * here are the kind that go wrong quietly — where a newly pinned tab lands,
 * which tab an open evicts, and which tab takes over when the active one
 * closes. As a pure function they are reachable by a doctest
 * (`test/frontend/sidecar-tabs.doctest.md`); inside a component they would not
 * be.
 *
 * Ordering is a property of the state, not of the render: `tabs` is always
 * pinned-first, insertion order within each group. The strip renders the array
 * as it stands.
 */

import { serializeViewUrl, type ViewTarget } from "../../lib/view-url";

export interface SidecarTab {
  target: ViewTarget;
  label: string;
  pinned: boolean;
  /** When this tab was last the active one — the eviction order. */
  lastActiveAt: number;
}

export interface SidecarState {
  tabs: SidecarTab[];
  activePath: string | null;
}

export type SidecarAction =
  | { type: "open"; target: ViewTarget; label: string; at: number }
  | { type: "select"; path: string; at: number }
  | { type: "close"; path: string }
  | { type: "togglePin"; path: string; at: number }
  | { type: "closeAll" }
  | { type: "restore"; state: SidecarState };

/**
 * How many unpinned tabs the strip keeps. Unbounded was fine while a reload
 * cleared the strip; now that it survives one, an afternoon of opens would come
 * back as a strip nobody can read. Pinned tabs are not counted and never
 * evicted — pinning is how you say "not this one".
 */
export const MAX_UNPINNED_TABS = 12;

export const EMPTY_SIDECAR: SidecarState = { tabs: [], activePath: null };

/** Pinned first, insertion order preserved within each group. */
function ordered(tabs: SidecarTab[]): SidecarTab[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}

/**
 * Drop least-recently-active unpinned tabs until the cap holds. The active tab
 * is never a candidate: evicting what the person is reading is the one thing
 * worse than a long strip.
 */
function evictToCap(state: SidecarState): SidecarState {
  const unpinned = state.tabs.filter((t) => !t.pinned);
  if (unpinned.length <= MAX_UNPINNED_TABS) return state;
  const candidates = unpinned
    .filter((t) => t.target.path !== state.activePath)
    .toSorted((a, b) => a.lastActiveAt - b.lastActiveAt);
  const doomed = new Set(candidates.slice(0, unpinned.length - MAX_UNPINNED_TABS).map((t) => t.target.path));
  if (doomed.size === 0) return state;
  return { ...state, tabs: state.tabs.filter((t) => !doomed.has(t.target.path)) };
}

function withActive(state: SidecarState, { path, at }: { path: string; at: number }): SidecarState {
  return {
    tabs: state.tabs.map((t) => (t.target.path === path ? { ...t, lastActiveAt: at } : t)),
    activePath: path,
  };
}

export function sidecarReducer(state: SidecarState, action: SidecarAction): SidecarState {
  switch (action.type) {
    case "open": {
      const { target, label, at } = action;
      const existing = state.tabs.find((t) => t.target.path === target.path);
      if (existing === undefined) {
        const tab: SidecarTab = { target, label, pinned: false, lastActiveAt: at };
        return evictToCap({ tabs: ordered([...state.tabs, tab]), activePath: target.path });
      }
      // One tab per path. Re-opening the same card with a different
      // viewer/params refreshes the existing tab's target in place (so `?view=`
      // actually switches) rather than colliding silently.
      const sameTarget = serializeViewUrl(existing.target) === serializeViewUrl(target);
      const tabs = sameTarget
        ? state.tabs
        : state.tabs.map((t) => (t.target.path === target.path ? { ...t, target, label } : t));
      return withActive({ ...state, tabs }, { path: target.path, at });
    }
    case "select":
      return withActive(state, { path: action.path, at: action.at });
    case "close": {
      const idx = state.tabs.findIndex((t) => t.target.path === action.path);
      if (idx === -1) return state;
      const tabs = state.tabs.filter((_, i) => i !== idx);
      if (state.activePath !== action.path) return { ...state, tabs };
      // Closing the active tab falls back to its neighbour: the one that slid
      // into its place, or the new last tab when it was the last.
      const next = tabs.length === 0 ? null : (tabs[Math.min(idx, tabs.length - 1)]?.target.path ?? null);
      return { tabs, activePath: next };
    }
    case "togglePin": {
      // Toggling counts as touching the tab. Without that, unpinning a
      // long-pinned tab hands it back to the unpinned group as its oldest
      // member, and the cap below evicts the very tab the person just acted on.
      const tabs = state.tabs.map((t) =>
        t.target.path === action.path ? { ...t, pinned: !t.pinned, lastActiveAt: action.at } : t,
      );
      // Unpinning can push the unpinned group past a cap it was inside before,
      // so the cap is re-applied here as well as on open.
      return evictToCap({ ...state, tabs: ordered(tabs) });
    }
    case "closeAll":
      return EMPTY_SIDECAR;
    case "restore":
      return { tabs: ordered(action.state.tabs), activePath: action.state.activePath };
  }
}
