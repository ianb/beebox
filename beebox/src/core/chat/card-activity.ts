/**
 * The activity vocabulary a view or figure reports with, and the per-send
 * attention a client stamps on a user turn.
 *
 * Every reported action goes to the activity log (`core/activity/`), which the
 * agent reads with `bbx chat activity`; nothing about activity rides on the
 * send itself. See `docs/plans/activity-log.md`.
 */

// `ACTIVITY_KINDS`/`ActivityKind` live in `shared/card-activity-kinds.ts`
// (extracted so the frontend can import the runtime array as a bundler-safe
// value). Re-exported here so this module's backend importers are unaffected.
import type { ActivityKind } from "../../shared/card-activity-kinds.js";

export { type ActivityKind };

/**
 * What a view calls to say the person touched its card: the kind, a short
 * detail line for the log entry, and an optional small JSON object kept with
 * it for the agent.
 */
export type ReportActivity = (...args: [kind: ActivityKind, detail?: string, activity?: Record<string, unknown>]) => void;

/**
 * The per-send attention a client stamps on a user turn, as one list of names
 * shared by the HTTP send body, `ChatSendInput`, and the client's SEND event:
 * `openCard`, the card open beside the chat (snapshot `open-card`). Omitted
 * when empty. Adding a field here is the one type change; the omit-when-empty
 * spreads at each hop still name it.
 */
export interface ChatSendContext {
  openCard?: string;
}
