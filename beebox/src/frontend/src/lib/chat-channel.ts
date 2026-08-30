/**
 * What the client tells the server about the surface it is sending from —
 * the `<chat-app channel>` snapshot attribute the agent shapes its answer for.
 *
 * The client decides rather than the server because the User-Agent cannot see
 * the difference that matters most: inside the iOS shell the WebView carries an
 * ordinary iPhone UA, so a server-side guess reports the native app as mobile
 * web and the agent describes a composer that isn't in the page. The server
 * keeps its UA classification as the fallback for a client that sends nothing
 * (`webapp/routes/chat-helpers.ts` `resolveChannel`).
 */

import type { ChatChannel } from "@shared/chat-channel";
import { isNativeShell } from "../components/chat/native-post";

/**
 * Tailwind's `sm` breakpoint (640px), which is the app's only client-side
 * notion of "mobile" — the composer row and the two-pane layouts switch on
 * `sm:` and nothing reads a viewport width in JavaScript. Below it, the user
 * sees the mobile layout, so that is what `web-mobile` means here.
 */
const WIDE_VIEWPORT_QUERY = "(min-width: 640px)";

/** The channel implied by a surface, as a pure function of what we observed. */
export function chatChannelFor(surface: { nativeShell: boolean; wideViewport: boolean }): ChatChannel {
  if (surface.nativeShell) return "ios-native";
  return surface.wideViewport ? "web-desktop" : "web-mobile";
}

/**
 * The channel for this browser right now. `isNativeShell()` is the shared
 * bridge-presence predicate the chat page uses to suppress the web composer
 * (`ChatPage.tsx`), reused rather than restated. The page ORs in the legacy
 * `?nativeComposer=1` param, which is unavailable off-route and only matters
 * for an installed iOS build predating the bridge function; such a build
 * reports `web-mobile` here, exactly what the User-Agent said before. (iOS is
 * the only native shell that exists; Android joins the union when its shell
 * does.)
 */
export function currentChatChannel(): ChatChannel {
  const wideViewport =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(WIDE_VIEWPORT_QUERY).matches;
  return chatChannelFor({ nativeShell: isNativeShell(), wideViewport });
}
