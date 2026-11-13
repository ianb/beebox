/**
 * Tells the iOS app whether this page is on a call, so it can hold the call
 * audio role and keep native dictation off (docs/plans/chat-calls.md, Track E;
 * contract B16). A no-op outside a native shell.
 */

import { postNativeMessage } from "../../components/chat/native-post";

export function reportCallActive(active: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  postNativeMessage(window, { channel: "beeboxCallState", payload: { active } });
}
