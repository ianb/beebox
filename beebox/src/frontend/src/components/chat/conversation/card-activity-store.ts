/** Captures preserve activity until acceptance, always under its original source. */
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- Pure accumulator runs in tap/tsx outside Vite, where @shared cannot resolve.
import { ACTIVITY_KINDS } from "../../../../../shared/card-activity-kinds.js";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- Pure accumulator runs in tap/tsx outside Vite, where @shared cannot resolve.
import { parseRef } from "../../../../../shared/ref-path.js";
import type { ActivityKind, CardStateDetails } from "@core/chat/card-activity.js";
import type { CardSendFields } from "../InteractiveChat-card-hooks";

interface ActivityValue { detail: string | undefined; revision: number }
interface CapturedActivity { source: string; values: Map<ActivityKind, ActivityValue> }
export class CardActivityStore {
  private readonly sources = new Map<string, Map<ActivityKind, ActivityValue>>();
  private readonly captured = new WeakMap<CardSendFields, CapturedActivity>();
  private revision = 0;

  report(source: string | undefined, activity: { kind: ActivityKind; detail?: string }): void {
    if (source === undefined) return;
    let values = this.sources.get(source);
    if (values === undefined) { values = new Map(); this.sources.set(source, values); }
    values.set(activity.kind, { detail: activity.detail, revision: ++this.revision });
  }
  capture(source: string | undefined): CardSendFields {
    if (source === undefined) return {};
    const values = new Map(this.sources.get(source));
    const kinds = ACTIVITY_KINDS.filter((kind) => values.has(kind));
    const cardState: CardStateDetails = {};
    for (const kind of kinds) {
      const detail = values.get(kind)?.detail;
      if (detail !== undefined && detail !== "") cardState[kind] = detail;
    }
    const fields: CardSendFields = { openCard: parseRef(source).path,
      ...(kinds.length === 0 ? {} : { cardActivity: kinds }),
      ...(Object.keys(cardState).length === 0 ? {} : { cardState }),
    };
    this.captured.set(fields, { source, values });
    return fields;
  }
  accepted(fields: CardSendFields): void {
    const snapshot = this.captured.get(fields);
    if (snapshot === undefined) return;
    const current = this.sources.get(snapshot.source);
    for (const [kind, value] of snapshot.values) {
      if (current?.get(kind)?.revision === value.revision) current.delete(kind);
    }
    if (current?.size === 0) this.sources.delete(snapshot.source);
    this.captured.delete(fields);
  }
}
