/**
 * Google Calendar sync notes — change descriptions and commit-message building.
 *
 * Pure helpers used by the google-calendar connector to turn raw sync activity
 * into human-readable SyncNotes, diff old/new .ics content, extract X-CB-*
 * annotations, and assemble narrative git commit messages. No API/filesystem.
 */

// eslint-disable-next-line import-x/no-rename-default
import ICAL from "ical.js";
import { type GoogleCalendarEvent } from "./google-calendar-ics.js";

export interface SyncNote {
  action: "new" | "updated" | "deleted" | "pushed" | "cancelled";
  summary: string;
  detail?: string;
  ref?: string;
  /** Full ICS content for deleted events (embedded in calendar-review job) */
  icsContent?: string;
  /** Event start date for priority heuristic */
  eventStart?: Date;
}

/** Parse event start as a Date (for priority heuristic) */
export function parseEventStart(event: GoogleCalendarEvent): Date | undefined {
  const dateTime = event.start?.dateTime;
  const dateOnly = event.start?.date;
  if (!dateTime && !dateOnly) return undefined;
  return dateTime ? new Date(dateTime) : new Date(dateOnly + "T00:00:00");
}

/** Format an event date for commit messages: "Thu Feb 20" or "Thu Feb 20 3:00 PM" */
export function formatEventDate(event: GoogleCalendarEvent): string {
  const dateTime = event.start?.dateTime;
  const dateOnly = event.start?.date;
  if (!dateTime && !dateOnly) return "";
  const d = dateTime ? new Date(dateTime) : new Date(dateOnly + "T00:00:00");
  const dayStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (dateOnly) return dayStr;
  const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dayStr} ${timeStr}`;
}

/** Compare old and new ICS content, return human-readable change descriptions */
export function describeChanges(oldContent: string, newContent: string): string[] {
  const changes: string[] = [];
  try {
    const oldComp = new ICAL.Component(ICAL.parse(oldContent));
    const newComp = new ICAL.Component(ICAL.parse(newContent));
    const oldV = oldComp.getFirstSubcomponent("vevent");
    const newV = newComp.getFirstSubcomponent("vevent");
    if (!oldV || !newV) return changes;

    const getProp = (v: ICAL.Component, name: string): string =>
      String(v.getFirstPropertyValue(name) || "");

    // Summary
    const oldSummary = getProp(oldV, "summary");
    const newSummary = getProp(newV, "summary");
    if (oldSummary !== newSummary) {
      changes.push(`title changed from "${oldSummary}" to "${newSummary}"`);
    }

    // Start/end times
    const oldStart = getProp(oldV, "dtstart");
    const newStart = getProp(newV, "dtstart");
    const oldEnd = getProp(oldV, "dtend");
    const newEnd = getProp(newV, "dtend");
    if (oldStart !== newStart || oldEnd !== newEnd) {
      changes.push("time changed");
    }

    // Location
    const oldLoc = getProp(oldV, "location");
    const newLoc = getProp(newV, "location");
    if (oldLoc !== newLoc) {
      if (!oldLoc) {
        changes.push(`added location: ${newLoc}`);
      } else if (!newLoc) {
        changes.push("location removed");
      } else {
        changes.push(`location changed to ${newLoc}`);
      }
    }

    // Description
    const oldDesc = getProp(oldV, "description");
    const newDesc = getProp(newV, "description");
    if (oldDesc !== newDesc) {
      changes.push("description updated");
    }

    // Transparency
    const oldTransp = getProp(oldV, "transp");
    const newTransp = getProp(newV, "transp");
    if (oldTransp !== newTransp) {
      changes.push(newTransp === "TRANSPARENT" ? "marked as free" : "marked as busy");
    }
  } catch (e) {
    // Can't parse — skip diffing
    console.warn("Failed to diff ICS content, skipping change descriptions:", e);
  }
  return changes;
}

/**
 * Extract X-CB-REASON and X-CB-REF from ICS content.
 * Returns the values and stripped content.
 */
export function extractCbAnnotations(content: string): { reason?: string; ref?: string; stripped: string } {
  let reason: string | undefined;
  let ref: string | undefined;

  const reasonMatch = content.match(/^x-cb-reason[:;](.*)$/im);
  if (reasonMatch) reason = reasonMatch[1]?.trim();

  const refMatch = content.match(/^x-cb-ref[:;](.*)$/im);
  if (refMatch) ref = refMatch[1]?.trim();

  // Strip the annotation lines
  const stripped = content
    .replace(/^x-cb-reason[:;].*\r?\n?/gim, "")
    .replace(/^x-cb-ref[:;].*\r?\n?/gim, "");

  const result: { reason?: string; ref?: string; stripped: string } = { stripped };
  if (reason) result.reason = reason;
  if (ref) result.ref = ref;
  return result;
}

/** Build narrative commit message from SyncNotes */
export function buildNarrativeCommitMessage(
  notes: SyncNote[],
  opts: { isFullResync: boolean; totalEvents?: number },
): string {
  if (opts.isFullResync) {
    const count = opts.totalEvents ?? notes.length;
    return `Sync calendar: full re-sync (token expired), ${count} events refreshed`;
  }

  const counts: Record<string, number> = {};
  for (const note of notes) {
    counts[note.action] = (counts[note.action] || 0) + 1;
  }

  const parts: string[] = [];
  if (counts["new"]) parts.push(`${counts["new"]} new`);
  if (counts["updated"]) parts.push(`${counts["updated"]} updated`);
  if (counts["deleted"]) parts.push(`${counts["deleted"]} deleted`);
  if (counts["pushed"]) parts.push(`${counts["pushed"]} pushed`);
  if (counts["cancelled"]) parts.push(`${counts["cancelled"]} cancelled`);

  let message = `Sync calendar: ${parts.join(", ")}`;

  // Group notes by action for the body
  const sections: Array<{ label: string; action: SyncNote["action"] }> = [
    { label: "New", action: "new" },
    { label: "Updated", action: "updated" },
    { label: "Pushed", action: "pushed" },
    { label: "Deleted", action: "deleted" },
    { label: "Cancelled", action: "cancelled" },
  ];

  const bodyParts: string[] = [];
  for (const { label, action } of sections) {
    const items = notes.filter((n) => n.action === action);
    if (items.length === 0) continue;
    const lines = items.map((n) => {
      let line = `- ${n.summary}`;
      if (n.detail) line += ` — ${n.detail}`;
      if (n.ref) line += ` [ref: ${n.ref}]`;
      return line;
    });
    bodyParts.push(`${label}:\n${lines.join("\n")}`);
  }

  if (bodyParts.length > 0) {
    message += `\n\n${bodyParts.join("\n\n")}`;
  }

  return message;
}
