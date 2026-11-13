/**
 * When this page stops being able to hold a call: it is being unloaded (a
 * closed or reloaded tab), or, in the iOS app, it went to the background
 * (docs/plans/chat-calls.md, Track E). Leaving then also finalizes a running
 * recording, so its uploaded audio is not left waiting for a finalize that
 * never comes. A desktop tab that is merely hidden stays on the call.
 */

import { isNativeShell } from "../../components/chat/native-post";

export function onPageExit(leave: () => void): () => void {
  const hidden = (): void => {
    if (document.visibilityState === "hidden") leave();
  };
  const native = isNativeShell();
  window.addEventListener("pagehide", leave);
  if (native) document.addEventListener("visibilitychange", hidden);
  return () => {
    window.removeEventListener("pagehide", leave);
    if (native) document.removeEventListener("visibilitychange", hidden);
  };
}
