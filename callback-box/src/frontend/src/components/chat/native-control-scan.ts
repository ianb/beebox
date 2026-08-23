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
 * The transport itself lives in `native-command-bridge.ts`, shared with the
 * pointer's `point-at-control` round trip.
 */

import { awaitNativeCommandResult, type NativeControlBridge } from "./native-command-bridge";
import {
  createNativeScanControlsCommand,
  type NativeControlEntry,
} from "./native-composer-command";
import type { UiScanEntry } from "@shared/ui-scan";

export const NATIVE_SCAN_TIMEOUT_MS = 1500;

/** The name the dump groups native composer chrome under. */
export const NATIVE_CONTAINER_ROLE = "native";

/**
 * Ask the shell for its control inventory. Resolves with the entries, or null
 * for every failure — no answer, a refusal, or an answer for someone else's
 * command. Never rejects: a scan that cannot reach native is a coverage fact,
 * not an error.
 */
export async function requestNativeControls(
  bridge: NativeControlBridge,
  { commandId, timeoutMs }: { commandId: string; timeoutMs: number },
): Promise<NativeControlEntry[] | null> {
  const command = createNativeScanControlsCommand(commandId);
  const result = await awaitNativeCommandResult(bridge, { command, timeoutMs });
  if (result === null || !result.ok) return null;
  // The kind is already matched by the wait, so this narrowing never fails at
  // runtime; it is here because the union admits another `ok:true` member.
  return result.kind === "scan-controls" ? result.controls : null;
}

/**
 * The native entries as dump entries: one landmark heading the group, then the
 * controls under it.
 *
 * `actions` comes from the shell, which reports what it can actually do with
 * each control: everything registered can be pointed at, and `focus`/`reveal`
 * appear only where the shell has an honest native meaning for them. An
 * installed build too old to point at anything reports no actions at all, and
 * the dump prints such an entry without a `control:` link rather than handing
 * out a pointer the app would break on.
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
      actions: control.actions,
      disabled: control.disabled,
      // Native reports what its registry holds, and the registry holds what is
      // on screen — a view that has disappeared has already deregistered — so
      // there is no off-screen native entry to report.
      offscreen: false,
    });
  }
  return entries;
}
