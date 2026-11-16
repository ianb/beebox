// How a scripted input engaged the sketch, shared by the headless runner and
// the browser replay: the verdict text, and folding repeated "(unhandled)"
// lines so a stream of moves the sketch ignores does not bury the rest.
import type { Msg } from "./tea.js";

/** The Msg an interaction folds as: the Msg union minus tick and param. */
export type InteractionMsg = Exclude<Msg, { type: "tick" } | { type: "param" }>;


/** The engagement verdict: named acknowledgment wins, else a model-reference change, else unhandled. */
export function verdict(a: { handled: readonly string[]; changed: boolean }): string {
  if (a.handled.length > 0) return a.handled.join(", ");
  return a.changed ? "Δmodel" : "(unhandled)";
}

/** ` on X in Y` for a mouse message with named drawings under it; empty otherwise. */
function onText(msg: InteractionMsg): string {
  if (msg.type !== "mousedown" && msg.type !== "mouseup" && msg.type !== "mousemove") return "";
  return msg.targets.length === 0 ? "" : ` on ${msg.targets.join(" in ")}`;
}

/**
 * Shows the first "(unhandled)" per input type and target path, and counts
 * the rest. The path is part of the key so that a named click the sketch did
 * not handle still shows after an earlier miss in empty space.
 */
export class UnhandledFold {
  #seen = new Set<string>();
  /** Per key: the line the summary names, and how many were hidden. */
  #more = new Map<string, { label: string; count: number }>();

  /** True when this input's line should be shown. */
  show(msg: InteractionMsg, text: string): boolean {
    if (text !== "(unhandled)") return true;
    // The names as a list: a name may itself contain " in ", so the printed path is not a key.
    const targets = msg.type === "mousedown" || msg.type === "mouseup" || msg.type === "mousemove" ? msg.targets : [];
    const key = JSON.stringify([msg.type, targets]);
    if (!this.#seen.has(key)) {
      this.#seen.add(key);
      return true;
    }
    const more = this.#more.get(key);
    this.#more.set(key, { label: msg.type + onText(msg), count: (more?.count ?? 0) + 1 });
    return false;
  }

  /** One line per input type and target path with hidden "(unhandled)" lines. */
  summary(): string[] {
    return [...this.#more.values()].map(({ label, count }) => `${label}: ${count} more unhandled (not listed)`);
  }
}

/** Human description of an interaction for the transcript (`mousedown (297,288) on weight-2 in pan-left`, `keydown ArrowUp`, `trigger reset`). */
export function describeInput(msg: InteractionMsg): string {
  switch (msg.type) {
    case "mousedown":
    case "mouseup":
    case "mousemove":
      return `${msg.type} (${msg.x},${msg.y})${onText(msg)}`;
    case "keydown":
    case "keyup":
      return `${msg.type} ${msg.key}`;
    case "trigger":
      return `trigger ${msg.name}`;
  }
}
