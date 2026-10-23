/**
 * A plain primary-button click: no modifier keys and button 0. Anything else
 * (new-tab or new-window gestures, middle/right button) belongs to the browser.
 */
export function isPlainLeftClick(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}): boolean {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}
