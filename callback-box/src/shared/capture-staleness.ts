/**
 * The staleness line for staged captures, shared by the sweep and the UI.
 *
 * The abandonment sweep uses it to decide that an idle `open` capture has been
 * given up on and a `failed:*` one needs a human rather than another automatic
 * retry (`core/capture/sweep.ts`). The chat's capture chip uses the same line to
 * decide whether a failure reads as fresh (retry is the obvious move) or aged
 * (it has been sitting unresolved, and discarding is the likelier answer).
 *
 * It lives in `shared/` rather than in the sweep because the sweep imports
 * `node:fs`: a value import from the frontend would drag the filesystem into
 * the browser bundle. Two constants would let the surfaces drift apart, which
 * is exactly the drift the chip is meant to close.
 */

/** No-activity window after which a staged capture is stale. */
export const ABANDONMENT_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
