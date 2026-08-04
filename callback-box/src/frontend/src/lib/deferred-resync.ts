/**
 * Coalesced, visibility-aware resync trigger.
 *
 * The house pattern for "many callers all want to resync at once, but should
 * produce at most one real invocation" is `view-bindings.ts`'s hand-rolled
 * `invalidating` flag + `queueMicrotask` guard. This factory generalizes that
 * pattern and adds the piece that guard didn't have: background-tab
 * quiescence. A hidden tab shouldn't make HTTP just because its WebSocket
 * reconnected or a bus event fired — nothing on screen needs the fresh data
 * until the tab is looked at again. So a trigger fired while `document.hidden`
 * is parked, not dropped, and fires exactly once when the tab becomes visible,
 * no matter how many triggers accumulated while backgrounded.
 *
 * Visibility is read through the small {@link VisibilityAdapter} seam rather
 * than the global `document` directly, so callers (and this module's own
 * doctest) can inject a fake tab-visibility timeline instead of stubbing
 * `document` — the codebase's frontend doctests run under plain Node, not
 * jsdom, so there is no real `document` to stub. The default adapter treats a
 * missing `document` (SSR, a non-browser evaluation) as always-visible, same
 * as `alwaysVisible: true`.
 */

/** The minimal visibility surface this module needs — real or faked. */
export interface VisibilityAdapter {
  /** True when the tab is currently hidden/backgrounded. */
  isHidden: () => boolean;
  /**
   * Subscribe to "the tab is no longer hidden" transitions. Returns an
   * unsubscribe function.
   */
  onVisible: (callback: () => void) => () => void;
}

const documentVisibilityAdapter: VisibilityAdapter = {
  isHidden: () => typeof document !== "undefined" && document.hidden,
  onVisible: (callback) => {
    if (typeof document === "undefined") return () => {};
    function handleVisibilityChange(): void {
      if (!document.hidden) callback();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  },
};

export interface CreateDeferredResyncOptions {
  /**
   * Skip visibility deferral entirely: same-tick coalescing still applies,
   * but a hidden tab no longer parks the invocation. For state whose
   * correctness — not just an on-screen refresh — depends on staying current
   * (e.g. a non-visual cache other code reads), where deferring would be
   * wrong rather than just a missed UI update. Default false.
   */
  alwaysVisible?: boolean;
  /** Injectable for tests; defaults to the real `document`. */
  visibility?: VisibilityAdapter;
}

export interface DeferredResync {
  /**
   * Request an invocation of `fn`. Same-tick calls collapse into one — the
   * first call in a microtask schedules the run, the rest no-op until the
   * microtask fires and resets the guard. While the tab is hidden, the
   * request is parked instead of scheduled; it fires once, the next time the
   * tab becomes visible (still subject to same-tick coalescing at that
   * point).
   */
  trigger: () => void;
  /** Detach the visibility-change listener. Call on teardown (e.g. unmount). */
  dispose: () => void;
}

/**
 * Build a `{ trigger, dispose }` pair backed by `fn`. See module docs for the
 * coalescing + hidden-tab-deferral contract.
 */
export function createDeferredResync(fn: () => void, opts?: CreateDeferredResyncOptions): DeferredResync {
  const alwaysVisible = opts?.alwaysVisible ?? false;
  const visibility = opts?.visibility ?? documentVisibilityAdapter;
  let scheduled = false;
  let pendingWhileHidden = false;

  function hidden(): boolean {
    return !alwaysVisible && visibility.isHidden();
  }

  function run(): void {
    scheduled = false;
    fn();
  }

  function trigger(): void {
    if (hidden()) {
      pendingWhileHidden = true;
      return;
    }
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(run);
  }

  function handleVisible(): void {
    if (!pendingWhileHidden) return;
    pendingWhileHidden = false;
    trigger();
  }

  const unsubscribe = alwaysVisible ? null : visibility.onVisible(handleVisible);

  function dispose(): void {
    unsubscribe?.();
  }

  return { trigger, dispose };
}
