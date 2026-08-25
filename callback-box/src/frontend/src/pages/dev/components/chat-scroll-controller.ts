/**
 * The seam between the dev scroll harness and whatever controller it is
 * exercising. The harness knows only this interface — the two attach points,
 * the two observable flags, the viewport height the send spacer needs, and the
 * imperative calls the chat makes (send anchor, button, prepend capture,
 * open-thread hold) — so a replacement controller can be registered here and
 * driven by the same scenarios without touching the harness or the scripts.
 *
 * `useChatScroll` (the shipping controller) already has exactly this shape; the
 * alias is what documents it as a contract rather than a coincidence.
 */

import { useChatScroll, type ChatScroll } from "../../../components/chat/chat-scroll";

export type HarnessScrollController = ChatScroll;

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
  name: "useChatScroll",
  description: "The shipping chat controller (components/chat/chat-scroll.ts).",
  use: useChatScroll,
};

export const CONTROLLERS: ControllerEntry[] = [DEFAULT_CONTROLLER];
