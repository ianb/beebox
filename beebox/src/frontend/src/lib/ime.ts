/**
 * Whether a keydown belongs to an input method's composition (Japanese,
 * Chinese, Korean and other IMEs), so Enter confirms the composed text and the
 * arrows move through candidates rather than acting on the page. Safari sends
 * the composition-ending Enter with `isComposing` false but `keyCode` 229, so
 * both are checked.
 */
export function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
