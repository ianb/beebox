/**
 * Prefixed console logger shared across the chat-session modules. Each module
 * previously kept its own identical `log(context, ...args)` helper differing
 * only in the bracketed prefix; `makeLog` factors out the implementation and
 * takes the prefix as an argument so each module keeps its own label.
 *
 *   const log = makeLog("ChatSessionPool");
 *   log("drainQueue", count);   // → [ChatSessionPool:drainQueue] 3
 */
export function makeLog(prefix: string): (context: string, ...args: unknown[]) => void {
  return (context: string, ...args: unknown[]): void => {
    console.log(`[${prefix}:${context}]`, ...args);
  };
}
