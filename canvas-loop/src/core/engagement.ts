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

/** Shows the first "(unhandled)" per input type and counts the rest. */
export class UnhandledFold {
  #seen = new Set<string>();
  #more = new Map<string, number>();

  /** True when this input's line should be shown. */
  show(type: string, text: string): boolean {
    if (text !== "(unhandled)") return true;
    if (!this.#seen.has(type)) {
      this.#seen.add(type);
      return true;
    }
    this.#more.set(type, (this.#more.get(type) ?? 0) + 1);
    return false;
  }

  /** One line per input type with hidden "(unhandled)" lines. */
  summary(): string[] {
    return [...this.#more].map(([type, count]) => `${type}: ${count} more unhandled (not listed)`);
  }
}

/** Human description of an interaction for the transcript (`mousedown (297,288)`, `keydown ArrowUp`, `trigger reset`). */
export function describeInput(msg: InteractionMsg): string {
  switch (msg.type) {
    case "mousedown":
    case "mouseup":
    case "mousemove":
      return `${msg.type} (${msg.x},${msg.y})`;
    case "keydown":
    case "keyup":
      return `${msg.type} ${msg.key}`;
    case "trigger":
      return `trigger ${msg.name}`;
  }
}
