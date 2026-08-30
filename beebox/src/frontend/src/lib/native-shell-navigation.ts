/**
 * A native WebView is paired to exactly one box. Cross-box navigation belongs
 * to the shell's own box menu; a normal browser can use the web box selector.
 */
export function webBoxSwitchingAvailable(nativeShell: boolean): boolean {
  return !nativeShell;
}
