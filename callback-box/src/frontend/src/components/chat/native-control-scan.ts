/**
 * The native half of a `cb chat ui` scan: ask the shell what its own controls
 * are, and fold the answer into the inventory the agent reads.
 *
 * Inside the iOS shell the DOM is the transcript and nothing else — the
 * composer, mic, capture and box switcher are SwiftUI. A DOM-only scan on a
 * phone therefore returns almost nothing while *looking* like a complete
 * answer, which is the exact failure this feature exists to avoid
 * (`docs/plans/agent-points-at-ui.md`, Track 5). So the handler asks the bridge,
 * waits {@link NATIVE_SCAN_TIMEOUT_MS}, and either merges what came back
 * (`coverage: "dom+native"`) or says out loud that it could not
 * (`coverage: "dom-native-unavailable"`).
 *
 * **One wait covers three failures.** No answer, an explicit `ok:false` result,
 * and an old iOS build that cannot decode the V2 envelope at all are treated
 * identically. That is deliberate: the old build answers with a *rejection
 * acknowledgement* (the envelope always carries a non-empty `id`, which is what
 * keeps that path loud), and the acknowledgement queue is drained by
 * `useNativeComposerCommands` for its own commands, so racing it for a reason
 * we would only report as "unavailable" buys nothing. The result channel is the
 * only thing this module listens to.
 *
 * Written against an injected {@link NativeControlBridge} rather than `window`,
 * so the whole round trip — answering, never answering, refusing — is exercised
 * by a doctest under plain Node (`test/frontend/native-control-scan.doctest.md`).
 */

import {
  createNativeScanControlsCommand,
  nativeCommandResultFromDetail,
  postNativeComposerCommand,
  type NativeControlEntry,
} from "./native-composer-command";
import type { UiScanEntry } from "@shared/ui-scan";

/**
 * How long the scan waits for the shell. Long enough for a main-thread hop and
 * a `evaluateJavaScript` round trip, short enough that the agent's CLI call is
 * not visibly slower for it; the whole request already has a server-side
 * deadline of its own.
 */
export const NATIVE_SCAN_TIMEOUT_MS = 1500;

/** The name the dump groups native composer chrome under. */
export const NATIVE_CONTAINER_ROLE = "native";

/**
 * The transport this module needs, and nothing else. `subscribe` hands over every
 * result detail the shell has posted (queue first, then live ones) and returns an
 * unsubscribe; `wait` schedules the deadline and returns a cancel.
 */
export interface NativeControlBridge {
  post: (id: string) => void;
  subscribe: (listener: (detail: unknown) => void) => () => void;
  wait: (ms: number, fire: () => void) => () => void;
}

/**
 * Ask the shell for its control inventory. Resolves with the entries, or null
 * for every failure — no answer, a refusal, or an answer for someone else's
 * command. Never rejects: a scan that cannot reach native is a coverage fact,
 * not an error.
 */
export function requestNativeControls(
  bridge: NativeControlBridge,
  { commandId, timeoutMs }: { commandId: string; timeoutMs: number },
): Promise<NativeControlEntry[] | null> {
  return new Promise((resolve) => {
    let settled = false;
    // Holders rather than consts: `subscribe` drains the shell's queue
    // synchronously, so this can in principle settle before either teardown
    // function exists. (In practice it cannot — `commandId` is fresh, so a
    // stale queued result never matches — but a `const` here would turn that
    // reasoning into a TDZ crash if it ever stopped holding.)
    let cancelWait: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    const finish = (entries: NativeControlEntry[] | null): void => {
      if (settled) return;
      settled = true;
      cancelWait?.();
      unsubscribe?.();
      resolve(entries);
    };
    unsubscribe = bridge.subscribe((detail) => {
      const result = nativeCommandResultFromDetail(detail);
      // A result for another command (or another kind) is not ours to consume;
      // the shell may be answering a `point-at-control` at the same time.
      if (result === null || result.id !== commandId || result.kind !== "scan-controls") return;
      finish(result.ok ? result.controls : null);
    });
    cancelWait = bridge.wait(timeoutMs, () => finish(null));
    bridge.post(commandId);
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
    post: (id) => postNativeComposerCommand(window, createNativeScanControlsCommand(id)),
    subscribe: (listener) => {
      const drain = (): void => {
        const queue = window.callbackboxNativeCommandResultQueue ?? [];
        window.callbackboxNativeCommandResultQueue = [];
        for (const detail of queue) listener(detail);
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

/**
 * The native entries as dump entries: one landmark heading the group, then the
 * controls under it.
 *
 * `actions` is **empty**, and that is the honest answer for now: this build can
 * list a native control but cannot point at one — `point-at-control` is the next
 * chunk of Track 5. The dump renders an addressless-action entry without a
 * `control:` link, so the agent describes these in words instead of handing the
 * user a pointer the app would break on. When native pointing lands, these gain
 * `["point"]` and the same entries start rendering as links.
 *
 * The group name comes from native (`container`), so a second native surface —
 * a capture screen, a settings sheet — heads its own group without a change
 * here. An empty inventory produces no landmark: a heading with nothing under
 * it would read as "this surface has no controls", which is a different claim
 * from "native answered and had none to report".
 */
export function nativeScanEntries(controls: readonly NativeControlEntry[]): UiScanEntry[] {
  const entries: UiScanEntry[] = [];
  const seenContainers = new Set<string>();
  for (const control of controls) {
    if (!seenContainers.has(control.container)) {
      seenContainers.add(control.container);
      entries.push({
        kind: "landmark",
        id: null,
        role: NATIVE_CONTAINER_ROLE,
        name: control.container,
        container: null,
        does: null,
        actions: [],
        disabled: false,
        offscreen: false,
      });
    }
    entries.push({
      kind: "control",
      id: control.id,
      role: control.role,
      name: control.label,
      container: control.container,
      does: control.does,
      actions: [],
      disabled: control.disabled,
      // Native reports what its registry holds, and the registry holds what is
      // on screen — a view that has disappeared has already deregistered — so
      // there is no off-screen native entry to report.
      offscreen: false,
    });
  }
  return entries;
}
