/**
 * SSR-aware wrapper around XState's useMachine.
 *
 * During SSR, checks the SSRStateContext for a pre-built snapshot
 * keyed by machine ID. If found, passes it to useMachine so the
 * component renders in that state instead of the machine's initial state.
 *
 * In the browser, the context is empty and this behaves identically to useMachine.
 */

import { createContext, useContext } from "react";
import { useMachine } from "@xstate/react";
import type { AnyStateMachine, ActorOptions, StateFrom, Actor, SnapshotFrom } from "xstate";

/**
 * Map of machine ID → persisted snapshot data.
 * The snapshot is the plain object produced by machine.resolveState() or
 * actor.getPersistedSnapshot().
 */
export type SSRStateMap = Record<string, unknown>;

export const SSRStateContext = createContext<SSRStateMap>({});

/**
 * Drop-in replacement for useMachine that checks SSRStateContext
 * for a pre-built snapshot.
 */
export function useSSRMachine<TMachine extends AnyStateMachine>(
  machine: TMachine,
  options?: ActorOptions<TMachine>,
): [StateFrom<TMachine>, Actor<TMachine>["send"], Actor<TMachine>] {
  const ssrState = useContext(SSRStateContext);
  // eslint-disable-next-line no-restricted-syntax -- SSRStateMap is Record<string, unknown> by design (persisted snapshots keyed by machine id); the real per-machine snapshot type is recovered here at the read boundary.
  const ssrSnapshot = ssrState[machine.id] as SnapshotFrom<TMachine> | undefined;

  return useMachine(machine, {
    ...options,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- SnapshotFrom<T> is a conditional type over a naked, unresolved generic (TMachine extends AnyStateMachine); the checker collapses it to `undefined` here even though every concrete instantiation carries a real snapshot type, so the fallback is genuinely live at every call site.
    snapshot: ssrSnapshot ?? options?.snapshot,
    // eslint-disable-next-line no-restricted-syntax -- the assembled options object widens past ActorOptions under the naked generic; narrowing back at this single call boundary.
  } as ActorOptions<TMachine>);
}
