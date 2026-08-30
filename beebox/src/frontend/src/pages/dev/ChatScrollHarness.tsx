/**
 * Dev-only route (/dev/chat-scroll) hosting the isolated chat scroll harness.
 * Thin wrapper so the harness UI lives under a components/ dir (exempt from the
 * page className restriction). See ChatScrollHarness for details.
 */

import { ChatScrollHarness } from "./components/ChatScrollHarness";

export function ChatScrollPage() {
  return <ChatScrollHarness />;
}
