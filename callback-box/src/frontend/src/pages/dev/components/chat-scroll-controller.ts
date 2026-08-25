/**
 * The seam between the dev scroll harness and whatever controller it is
 * exercising. The harness knows only this interface — attach points for the
 * scroller and content elements, two observable flags, and the two imperative
 * calls the chat makes — so a replacement controller can be registered here and
 * driven by the same scenarios without touching the harness or the scripts.
 *
 * `useStickToBottom` (the shipping controller) already has exactly this shape;
 * the alias is what documents it as a contract rather than a coincidence.
 */

import { useStickToBottom, type StickToBottom } from "../../../components/chat/InteractiveChat-scroll";

export type HarnessScrollController = StickToBottom;

export type HarnessControllerHook = () => HarnessScrollController;

export interface ControllerEntry {
  name: string;
  description: string;
  use: HarnessControllerHook;
}

/**
 * Registry of controllers the harness can mount. Add a rewrite here and it
 * shows up in the picker; switching remounts the frame (hooks can't be swapped
 * in place), which is also the clean-slate every scenario run wants anyway.
 */
export const DEFAULT_CONTROLLER: ControllerEntry = {
  name: "useStickToBottom",
  description: "The shipping chat controller (components/chat/InteractiveChat-scroll.ts).",
  use: useStickToBottom,
};

export const CONTROLLERS: ControllerEntry[] = [DEFAULT_CONTROLLER];
