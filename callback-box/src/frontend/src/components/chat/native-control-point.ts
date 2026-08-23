/**
 * The native half of a `control:` pointer (`docs/plans/agent-points-at-ui.md`,
 * Track 5, "Pointing at a native control").
 *
 * Inside the iOS shell the composer, mic and capture have no DOM element behind
 * them, so a pointer at one resolves to nothing. "Nothing" is the wrong answer
 * there: the control is on screen, it is simply not the browser's. So when the
 * DOM resolve fails and the bridge is present, `ControlPointer` sends
 * `point-at-control` and the shell draws the ring on its own view — or refuses
 * with a reason, which the pointer shows as `BrokenLink`.
 *
 * Every failure here carries a sentence the user can read, because the failure
 * is the *normal* case for a pointer at a control that has since gone away, and
 * a pointer that quietly does nothing is exactly what the broken treatment
 * exists to prevent (`code-style.md`, "user-initiated actions never silently
 * no-op").
 */

import { awaitNativeCommandResult, type NativeControlBridge } from "./native-command-bridge";
import { createNativePointAtControlCommand } from "./native-composer-command";
import type { ControlAction } from "../../lib/ui-scan/types";

/**
 * How long the pointer waits for the shell before calling the control
 * unreachable. Same budget as the scan: one main-thread hop plus an
 * `evaluateJavaScript` round trip, and short enough that a tap that is not
 * going to be answered says so while the user is still looking at it.
 */
export const NATIVE_POINT_TIMEOUT_MS = 1500;

/** What the shell said. A refusal and a silence both carry a readable reason. */
export type NativePointOutcome = { ok: true } | { ok: false; reason: string };

/**
 * What a timeout means to the user. Deliberately not "the app refused" — the
 * shell may well have drawn the ring and lost the answer — so it says what is
 * actually known: no confirmation arrived.
 */
export const NATIVE_POINT_TIMEOUT_REASON =
  "The app did not answer in time, so this control could not be pointed at.";

/**
 * Ask the shell to act on one of its own controls. Never rejects: an
 * unanswering shell is reported the same way a refusing one is, because to the
 * person tapping the link they are the same event.
 */
export async function requestNativePointAtControl(
  bridge: NativeControlBridge,
  {
    commandId,
    controlId,
    action,
    timeoutMs,
  }: { commandId: string; controlId: string; action: ControlAction; timeoutMs: number },
): Promise<NativePointOutcome> {
  const command = createNativePointAtControlCommand(commandId, { id: controlId, action });
  const result = await awaitNativeCommandResult(bridge, { command, timeoutMs });
  if (result === null) return { ok: false, reason: NATIVE_POINT_TIMEOUT_REASON };
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
