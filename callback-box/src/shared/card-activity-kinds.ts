/**
 * The card-activity kind vocabulary — the four terse verbs describing what the
 * user did to the companion-pane card since the agent's last reply. Extracted
 * to `shared/` (from `core/chat/card-activity.ts`) so the frontend can import
 * the runtime array (`ACTIVITY_KINDS`) as a bundler-safe value.
 * `core/chat/card-activity.ts` re-exports both and owns the
 * union/serialization logic that operates on them.
 *
 * Canonical order (least → most consequential): `scrolled`, `navigated`,
 * `explored`, `modified`. Rendering and union both project onto this order.
 */
export const ACTIVITY_KINDS = ["scrolled", "navigated", "explored", "modified"] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
