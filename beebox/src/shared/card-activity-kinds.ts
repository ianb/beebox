/**
 * The activity kind vocabulary: the four terse verbs a view, figure or the
 * companion pane reports for the activity log. Lives in `shared/` so the
 * frontend can import the runtime array (`ACTIVITY_KINDS`) as a bundler-safe
 * value; `core/chat/card-activity.ts` re-exports the type.
 *
 * Order (least to most consequential): `scrolled`, `navigated`, `explored`,
 * `modified`.
 */
export const ACTIVITY_KINDS = ["scrolled", "navigated", "explored", "modified"] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
