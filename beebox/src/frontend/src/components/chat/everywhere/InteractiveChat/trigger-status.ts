/**
 * The words of the chat column's trigger status line
 * (plan:activity-triggers, Track F): "Watching: Water check" while
 * triggers are armed, "Water check: not working" for one whose last
 * evaluation failed, nothing when none is live. Principle: the line shows the
 * state the system is in, never "watching" while the last run failed.
 */

export interface TriggerStatusEntry {
  label: string;
  state: "armed" | "failed" | "done" | "expired" | "disarmed" | "delivery-failed";
}

/** The lines to show, in order: one "Watching: …" for the armed ones, then one per failed one (a failed evaluation or a fire that could not be delivered). Empty when nothing is live. */
export function triggerStatusLines(entries: readonly TriggerStatusEntry[]): string[] {
  const lines: string[] = [];
  const watching = entries.filter((e) => e.state === "armed").map((e) => e.label);
  if (watching.length > 0) lines.push(`Watching: ${watching.join(", ")}`);
  for (const e of entries) if (e.state === "failed" || e.state === "delivery-failed") lines.push(`${e.label}: not working`);
  return lines;
}
