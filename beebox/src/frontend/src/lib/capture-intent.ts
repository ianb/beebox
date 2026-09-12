/** A consumed capture request opens capture without closing an already-open overlay. */
export function captureModeForRequest(current: boolean, requested: boolean): boolean {
  return requested || current;
}
