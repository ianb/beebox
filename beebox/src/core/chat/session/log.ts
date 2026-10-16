/**
 * Prefixed console logger shared across the chat-session modules. Each module
 * previously kept its own identical `log(context, ...args)` helper differing
 * only in the bracketed prefix; `makeLog` factors out the implementation and
 * takes the prefix as an argument so each module keeps its own label.
 *
 *   const log = makeLog("ChatSession");
 *   log("drainQueue", count);   // → [ChatSession:drainQueue] 3
 *
 * These lines are a box server's record of its chat sessions. The test suite
 * sets `BBX_CHAT_SESSION_LOG=off` (test/helpers/quiet-chat-session-log.ts):
 * every test that drives a real session would otherwise print them into its
 * TAP output. Read per call, so a test can turn them back on.
 */
export function makeLog(prefix: string): (context: string, ...args: unknown[]) => void {
  return (context: string, ...args: unknown[]): void => {
    if (process.env["BBX_CHAT_SESSION_LOG"] === "off") return;
    console.log(`[${prefix}:${context}]`, ...args);
  };
}
