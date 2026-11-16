/**
 * The page's side of build skew: hold the server's frontend build identity
 * (heard on `build.watch`), track whether the tab was just shown, and act on
 * `decideBuildAction` — reload, or raise the banner.
 *
 * Two moments decide: the tab being shown (`visibilitychange`, `pageshow`)
 * and a `build.watch` frame arriving. A frame matters on its own because on
 * an iOS resume or a woken laptop the socket reconnects a moment AFTER the
 * tab is shown; the "fresh show" window (until the first pointer or key input,
 * at most {@link FRESH_SHOW_MS}) lets that late frame still count as the
 * return to the tab.
 *
 * The loop guard: before reloading, the tab writes the build it ran and the
 * server build it is reloading for into `sessionStorage`. If the reloaded page
 * still runs an older build (a cache, a half-finished deploy), the record
 * matches the server build and the decision shows the banner instead of
 * reloading again. The record is cleared once the page runs the server's
 * build.
 *
 * Every skew is written once per (server build, action) to the console as a
 * `[build]` warning, which the debug log forwards to the server even with
 * the panel closed. The reload itself would discard a warning still waiting
 * in the debug log's send buffer, so the page that loads after the reload
 * writes the `reloaded` line from the record.
 */

import { decideBuildAction, type BuildAction } from "./decide";

/** How long after the tab is shown a late identity frame still counts as the return to the tab. */
export const FRESH_SHOW_MS = 30_000;

const ATTEMPT_KEY = "bbx-build-reload";

export interface BuildSkewDeps {
  clientBuild: string | null;
  now: () => number;
  isVisible: () => boolean;
  blockers: () => readonly string[];
  /** Tab-scoped storage (`sessionStorage`); a throwing accessor means none. */
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
  reload: () => void;
  warn: (message: string) => void;
}

export interface BuildSkewSnapshot {
  /** The banner is up: skew this tab will not resolve by itself. */
  banner: boolean;
}

export interface BuildSkewStore {
  /** A `build.watch` frame. */
  serverBuild: (identity: string | null) => void;
  /** The tab became visible, or the page was shown from the back-forward cache. */
  shown: () => void;
  /** Pointer or key input: the person is using the tab. */
  touched: () => void;
  dismiss: () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => BuildSkewSnapshot;
}

export function createBuildSkewStore(deps: BuildSkewDeps): BuildSkewStore {
  let server: string | null = null;
  let shownAt = deps.now();
  let touchedSinceShown = false;
  let dismissedFor: string | null = null;
  let snapshot: BuildSkewSnapshot = { banner: false };
  const logged = new Set<string>();
  const listeners = new Set<() => void>();

  function setBanner(banner: boolean): void {
    if (snapshot.banner === banner) return;
    snapshot = { banner };
    for (const listener of listeners) listener();
  }

  /** The earlier reload's `{ from, to }`, null for none, `unavailable` when storage cannot be read. */
  function readAttempt(): { from: string; to: string } | null | "unavailable" {
    let raw: string | null;
    try {
      raw = deps.storage().getItem(ATTEMPT_KEY);
    } catch (_error) {
      return "unavailable";
    }
    const [from, to] = raw?.split(">") ?? [];
    return from === undefined || to === undefined ? null : { from, to };
  }

  function log(action: BuildAction, blockers: readonly string[]): void {
    const key = `${server ?? ""}:${action}`;
    if (logged.has(key)) return;
    logged.add(key);
    const why = action === "banner" && blockers.length > 0 ? ` blockers=${blockers.join(",")}` : "";
    deps.warn(`[build] skew client=${deps.clientBuild ?? "none"} server=${server ?? "none"} action=${action}${why}`);
  }

  function evaluate(): void {
    const attempt = readAttempt();
    const attempted = attempt === null || attempt === "unavailable" ? attempt : attempt.to;
    const blockers = deps.blockers();
    const action = decideBuildAction({
      client: deps.clientBuild,
      server,
      visible: deps.isVisible(),
      freshShow: !touchedSinceShown && deps.now() - shownAt <= FRESH_SHOW_MS,
      blockers,
      attempted,
    });
    if (action === "none") {
      if (server !== null && server === deps.clientBuild && attempt !== null && attempt !== "unavailable") {
        deps.warn(`[build] reloaded client=${attempt.from} server=${server}`);
        try {
          deps.storage().removeItem(ATTEMPT_KEY);
        } catch (_error) {
          // Nothing to clean up in storage this tab cannot reach.
        }
      }
      setBanner(false);
      return;
    }
    if (action === "reload") {
      try {
        deps.storage().setItem(ATTEMPT_KEY, `${deps.clientBuild ?? ""}>${server ?? ""}`);
      } catch (_error) {
        // The record is the loop guard; without it, do not reload.
        log("banner", blockers);
        setBanner(dismissedFor !== server);
        return;
      }
      log("reload", blockers);
      deps.reload();
      return;
    }
    log(action, blockers);
    if (action === "wait") return;
    setBanner(dismissedFor !== server);
  }

  return {
    serverBuild: (identity) => {
      server = identity;
      evaluate();
    },
    shown: () => {
      shownAt = deps.now();
      touchedSinceShown = false;
      evaluate();
    },
    touched: () => {
      touchedSinceShown = true;
    },
    dismiss: () => {
      dismissedFor = server;
      setBanner(false);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
}
