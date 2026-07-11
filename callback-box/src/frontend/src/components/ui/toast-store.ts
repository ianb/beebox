/**
 * Toast store — the app's one transient user-visible error channel.
 *
 * Chat action handlers, machine actions, and plain async code all fail in
 * places the stream-error banner (`chatMachine` `context.error`, gated to the
 * "streaming" state) can't reach. Rather than thread an error slot through
 * every one, this is a module-level store any code can call:
 *
 *   toastError("Failed to restart the agent process", { cause: e });
 *
 * Errors only — no speculative success/info vocabulary. The React side binds
 * via `useSyncExternalStore` (the house store pattern, see `input-store.ts`)
 * in `ToastViewport`; the viewport owns its own `role="alert"` landmark.
 *
 * Framework-free (no React/DOM import) so the store logic — dedupe counter,
 * auto-expiry, dismiss — is doctestable headlessly; timers are injected via
 * `schedule` so a doctest fires expiry deterministically instead of waiting.
 */

/** Default auto-expiry for an error toast. */
const DEFAULT_TTL_MS = 10_000;

export interface Toast {
  /** Stable identity for React keys and dismissal. */
  readonly id: number;
  /** The primary, human-facing message ("Failed to restart the agent process"). */
  readonly message: string;
  /**
   * The underlying error detail (an `Error.message` or stringified cause),
   * surfaced as a secondary line + `title` so the real failure is never
   * silently dropped. Absent when no cause was supplied.
   */
  readonly detail?: string;
  /**
   * How many times an identical `message` collapsed into this toast. Rendered
   * as a counter (×N) once it exceeds 1.
   */
  readonly count: number;
}

/**
 * Cancels a scheduled expiry. Returned by `schedule`; kept per-toast so a
 * repeat (which restarts the timer) or an early dismiss can cancel cleanly.
 */
type CancelTimer = () => void;

export interface ToastStoreOptions {
  /** Auto-expiry in ms (default 10s). */
  ttlMs?: number;
  /**
   * Timer seam (default `setTimeout`/`clearTimeout`). Injected in doctests so
   * expiry is driven deterministically. Returns a cancel function. Must defer
   * the callback (never invoke it synchronously) — like `setTimeout`, arming
   * an expiry that fires within the same tick would re-enter mid-mutation.
   */
  schedule?: (callback: () => void, ms: number) => CancelTimer;
}

const defaultSchedule = (callback: () => void, ms: number): CancelTimer => {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
};

function describeCause(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) return cause.message;
  const text = String(cause);
  return text === "" ? undefined : text;
}

export interface ToastStore {
  /** Raise an error toast; identical messages collapse into one with a counter. */
  error: (message: string, opts?: { cause?: unknown }) => void;
  /** Dismiss a toast by id (the user's close button). No-op if already gone. */
  dismiss: (id: number) => void;
  /** Subscribe to changes; returns an unsubscribe. Backs `useSyncExternalStore`. */
  subscribe: (listener: () => void) => () => void;
  /** Current toasts, as a stable snapshot value (same reference until a mutation). */
  getSnapshot: () => readonly Toast[];
}

export function createToastStore(options?: ToastStoreOptions): ToastStore {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const schedule = options?.schedule ?? defaultSchedule;

  let toasts: readonly Toast[] = [];
  let nextId = 1;
  const timers = new Map<number, CancelTimer>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function armExpiry(id: number): void {
    timers.get(id)?.();
    timers.set(id, schedule(() => remove(id), ttlMs));
  }

  function remove(id: number): void {
    timers.get(id)?.();
    timers.delete(id);
    const next = toasts.filter((toast) => toast.id !== id);
    if (next.length === toasts.length) return;
    toasts = next;
    notify();
  }

  function error(message: string, opts?: { cause?: unknown }): void {
    const detail = describeCause(opts?.cause);
    // Collapse an identical message into the existing toast with a counter,
    // refreshing its detail to the latest cause and restarting its expiry.
    const existing = toasts.find((toast) => toast.message === message);
    if (existing) {
      toasts = toasts.map((toast) =>
        toast.id === existing.id
          ? { ...toast, count: toast.count + 1, detail: detail ?? toast.detail }
          : toast
      );
      armExpiry(existing.id);
      notify();
      return;
    }
    const id = nextId++;
    toasts = [...toasts, { id, message, detail, count: 1 }];
    armExpiry(id);
    notify();
  }

  return {
    error,
    dismiss: remove,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => toasts,
  };
}

/**
 * The app-wide singleton. `toastError` is importable and callable from
 * anywhere — hooks, xstate machine actions, plain async `.catch` — with no
 * provider in scope.
 */
const store = createToastStore();

export const toastError = store.error;
export const dismissToast = store.dismiss;
export const subscribeToasts = store.subscribe;
export const getToasts = store.getSnapshot;
