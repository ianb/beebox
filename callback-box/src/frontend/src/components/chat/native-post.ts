/**
 * Web→native posting for the embedded native shells (iOS/Android).
 *
 * The neutral `callbackboxNativePost(channel, payload)` function is defined by
 * each shell's document-start script; payloads always cross as strings.
 * Shells that predate the neutral function (older installed iOS builds) get
 * the legacy WKScriptMessageHandler object form instead. Contract:
 * docs/mobile-contract.md (Track 0 of docs/plans/android-companion-app.md).
 */

export type NativeShellChannel =
  | "callbackboxEmissionReceipt"
  | "callbackboxLocationResult"
  | "callbackboxLocationState"
  | "callbackboxNarrationState"
  | "callbackboxComposerCommand"
  | "callbackboxSession";

export interface NativeShellWindow {
  callbackboxNativePost?: (channel: string, payload: string) => void;
  webkit?: {
    messageHandlers?: Partial<
      Record<NativeShellChannel, { postMessage: (message: unknown) => void }>
    >;
  };
}

/**
 * True when running inside a native shell (iOS/Android WebView). Keys off the
 * document-start bridge function, which the shell injects on EVERY page load
 * (`ChatWebView.swift` `startupScript()`), so it survives in-app navigation —
 * unlike the initial-URL `?nativeComposer=1` param, which is lost the moment the
 * WebView navigates same-origin and left the native + web composers both showing.
 * SSR-safe; the global `Window` augmentation in `use-native-bridge.ts` types the
 * property.
 */
export function isNativeShell(): boolean {
  return typeof window !== "undefined" && typeof window.callbackboxNativePost === "function";
}

export function postNativeMessage(
  shell: NativeShellWindow,
  { channel, payload }: { channel: NativeShellChannel; payload: unknown }
): void {
  const post = shell.callbackboxNativePost;
  if (post !== undefined) {
    post(channel, typeof payload === "string" ? payload : JSON.stringify(payload));
    return;
  }
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- WKScriptMessageHandler accepts only the payload.
  shell.webkit?.messageHandlers?.[channel]?.postMessage(payload);
}
