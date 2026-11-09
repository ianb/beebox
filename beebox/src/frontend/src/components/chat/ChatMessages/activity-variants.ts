/**
 * TEMPORARY (plan `chat-activity-stages`): the design options the boxholder
 * is choosing between, switched by `localStorage["bbx-activity-variant"]`
 * (JSON). Removed once the choices are made; the chosen ones become the code.
 */

export interface ActivityVariant {
  /** Collapsed summary: stage count, newest note, or today's summary plus a note count. */
  summary: "count" | "note" | "today";
  /** Expanded: notes as headings over their steps, or each stage folded on its own. */
  notes: "heading" | "fold";
  /** A step named by its command: faded monospace, "Ran …" text, or "Took a step" plus faded command. */
  command: "mono" | "text" | "suffix";
  /** While streaming: fold notes as steps arrive, or keep them inline until the turn ends. */
  stream: "fold" | "inline";
}

const DEFAULT: ActivityVariant = { summary: "note", notes: "heading", command: "mono", stream: "fold" };

export function activityVariant(): ActivityVariant {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem("bbx-activity-variant") ?? "{}");
    return typeof raw === "object" && raw !== null ? { ...DEFAULT, ...raw } : DEFAULT;
  } catch (_error) {
    return DEFAULT;
  }
}
