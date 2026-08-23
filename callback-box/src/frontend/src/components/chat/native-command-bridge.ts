/**
 * The shared web↔native request/answer transport for V2 commands.
 *
 * Two features ride it — the control scan (`native-control-scan.ts`) and the
 * native half of a `control:` pointer (`native-control-point.ts`) — and they can
 * be in flight at the same time, so the queue discipline lives here once rather
 * than in each of them.
 *
 * Written against an injected {@link NativeControlBridge} rather than `window`,
 * so every outcome — answered, refused, never answered, answered for someone
 * else — is exercised by a doctest under plain Node.
 */

import {
  nativeCommandResultFromDetail,
  postNativeComposerCommand,
  type NativeCommandResult,
  type NativeComposerCommand,
} from "./native-composer-command";

/**
 * How many unconsumed results the queue keeps. A result nobody claims — a late
 * answer to a request that already timed out — would otherwise sit there
 * forever, so the queue keeps the most recent few and drops the rest.
 */
const RESULT_QUEUE_LIMIT = 10;

/**
 * The transport a V2 request needs, and nothing else. `subscribe` hands over
 * every result detail the shell has posted (queue first, then live ones) and
 * returns an unsubscribe; `wait` schedules the deadline and returns a cancel.
 *
 * The listener returns whether it **consumed** the detail. The queue is shared —
 * a second scan, or a `point-at-control` answer, reads the same one — so a
 * subscriber that emptied it wholesale would swallow someone else's result. What
 * one subscriber does not claim stays queued for whoever it belongs to.
 */
export interface NativeControlBridge {
  post: (command: NativeComposerCommand) => void;
  subscribe: (listener: (detail: unknown) => boolean) => () => void;
  wait: (ms: number, fire: () => void) => () => void;
}

/**
 * Post `command` and resolve with the shell's answer to it, or `null` when the
 * deadline passed first. Never rejects: an unreachable shell is a fact the
 * caller reports, not an error it handles.
 *
 * A result is *ours* when both its command id and its kind match — the kind
 * check is not redundant, because a malformed shell answering the wrong kind
 * under our id would otherwise be handed back as the wrong union member.
 */
export function awaitNativeCommandResult(
  bridge: NativeControlBridge,
  { command, timeoutMs }: { command: NativeComposerCommand; timeoutMs: number },
): Promise<NativeCommandResult | null> {
  return new Promise((resolve) => {
    let settled = false;
    // Holders rather than consts: `subscribe` drains the shell's queue
    // synchronously, so this can in principle settle before either teardown
    // function exists. (In practice it cannot — the command id is fresh, so a
    // stale queued result never matches — but a `const` here would turn that
    // reasoning into a TDZ crash if it ever stopped holding.)
    let cancelWait: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    const finish = (result: NativeCommandResult | null): void => {
      if (settled) return;
      settled = true;
      cancelWait?.();
      unsubscribe?.();
      resolve(result);
    };
    unsubscribe = bridge.subscribe((detail) => {
      const result = nativeCommandResultFromDetail(detail);
      if (result === null || result.id !== command.id || result.kind !== command.kind) return false;
      finish(result);
      return true;
    });
    cancelWait = bridge.wait(timeoutMs, () => finish(null));
    bridge.post(command);
  });
}

/**
 * The bridge as it exists in a real webview: post through the neutral
 * `callbackboxNativePost`, read the shell-owned result queue, and wake on the
 * event the shell dispatches after pushing to it. The queue is authoritative —
 * a result posted before this subscription existed is still in it — and the
 * event is only a wake signal, which is the same discipline the emission and
 * acknowledgement queues follow.
 */
export function windowNativeControlBridge(): NativeControlBridge {
  return {
    post: (command) => postNativeComposerCommand(window, command),
    subscribe: (listener) => {
      const drain = (): void => {
        const queue = window.callbackboxNativeCommandResultQueue ?? [];
        window.callbackboxNativeCommandResultQueue = [];
        const unclaimed = queue.filter((detail) => !listener(detail));
        // Put back what this subscriber did not claim, newest first past the cap,
        // and behind anything the shell posted while we were draining.
        window.callbackboxNativeCommandResultQueue = [
          ...unclaimed.slice(-RESULT_QUEUE_LIMIT),
          ...(window.callbackboxNativeCommandResultQueue ?? []),
        ];
      };
      window.addEventListener("callbackbox:native-command-result", drain);
      drain();
      return () => window.removeEventListener("callbackbox:native-command-result", drain);
    },
    wait: (ms, fire) => {
      const timer = window.setTimeout(fire, ms);
      return () => window.clearTimeout(timer);
    },
  };
}
