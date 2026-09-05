/**
 * How a Drive card reads in the UI: what a mirrored folder's child is, and
 * what a pointer's mime type is called.
 *
 * Both are pure lookups over card fields the box already holds — no fetch, no
 * Drive call. That is the whole promise of the `gfolder` view (plan Track 4):
 * it shows **box state**, not a live listing, so a child says "synced" only
 * because its own card says so. Keeping the mapping here rather than inside
 * the renderer is what lets a doctest pin it without a DOM.
 */

import type { BadgeTone } from "../components/ui/Badge";

/**
 * What the box holds for one child of a mirrored directory.
 *
 * - `synced` — a Doc/Sheet card whose content is mirrored two-way.
 * - `conflict` — the same, but its last sync could not reconcile the two
 *   sides. Distinguished from `synced` because a conflicted card is stale in
 *   a way the boxholder has to resolve.
 * - `pointer` — a `.glink.card`: the box knows the item exists and nothing
 *   was copied.
 * - `subfolder` — a nested `.gfolder.card`, i.e. a mount of its own.
 * - `not-drive` — a card someone put in the directory that Drive knows
 *   nothing about. The mirror leaves it alone; the column says so rather
 *   than implying it is synced.
 */
export type DriveChildState = "synced" | "conflict" | "pointer" | "subfolder" | "not-drive";

/** The fields `status.browse` reports per card — all this mapping needs. */
export interface DriveChildCard {
  type: string;
  /** The card's `status` frontmatter field, when it has one. */
  status?: string | undefined;
}

/** Card types whose content the Drive connector mirrors two-way. */
const SYNCED_CARD_TYPES = new Set(["gdoc", "gsheet"]);

/**
 * The Drive state of one child card, from the card alone.
 *
 * `conflict` is read off the child's own `status`, never inferred from the
 * folder's: a mount can report `status: ok` for a listing that succeeded while
 * one child's content sync failed, and the column has to show that.
 */
export function driveChildState(card: DriveChildCard): DriveChildState {
  if (card.type === "glink") return "pointer";
  if (card.type === "gfolder") return "subfolder";
  if (!SYNCED_CARD_TYPES.has(card.type)) return "not-drive";
  return card.status === "conflict" ? "conflict" : "synced";
}

export interface DriveChildBadge {
  label: string;
  tone: BadgeTone;
  /** Hover text — the one-line reason the state means what it says. */
  title: string;
}

/** How each state is spelled and toned in the child list. */
export const DRIVE_CHILD_BADGES: Record<DriveChildState, DriveChildBadge> = {
  synced: {
    label: "synced",
    tone: "success",
    title: "Content is mirrored two-way with Drive.",
  },
  conflict: {
    label: "conflict",
    tone: "danger",
    title: "The last sync could not reconcile the box and Drive copies.",
  },
  pointer: {
    label: "pointer",
    tone: "info",
    title: "Nothing is copied — the card records where the item lives.",
  },
  subfolder: {
    label: "subfolder mount",
    tone: "accent",
    title: "A mirrored Drive folder of its own.",
  },
  "not-drive": {
    label: "not a Drive card",
    tone: "neutral",
    title: "The mirror leaves this card alone.",
  },
};

/**
 * Mime types worth a name. Everything else keeps its raw mime — a wrong-but-
 * friendly label ("Document") would hide what the item actually is, and the
 * raw string is what `bbx drive inspect` prints anyway.
 */
const MIME_LABELS = new Map<string, string>([
  ["application/vnd.google-apps.document", "Google Doc"],
  ["application/vnd.google-apps.spreadsheet", "Google Sheet"],
  ["application/vnd.google-apps.presentation", "Google Slides"],
  ["application/vnd.google-apps.form", "Google Form"],
  ["application/vnd.google-apps.drawing", "Google Drawing"],
  ["application/vnd.google-apps.folder", "Drive folder"],
  ["application/vnd.google-apps.shortcut", "Drive shortcut"],
  ["application/pdf", "PDF"],
  ["text/plain", "Text file"],
  ["text/csv", "CSV"],
  ["text/markdown", "Markdown"],
  ["application/zip", "ZIP archive"],
  ["application/msword", "Word document"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Word document"],
  ["application/vnd.ms-excel", "Excel spreadsheet"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Excel spreadsheet"],
  ["application/vnd.ms-powerpoint", "PowerPoint deck"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "PowerPoint deck"],
]);

/** Families that read fine as a one-word kind when the exact subtype does not. */
const MIME_FAMILY_LABELS = new Map<string, string>([
  ["image", "Image"],
  ["video", "Video"],
  ["audio", "Audio"],
]);

/**
 * A human label for a pointer's mime type, falling back to the raw mime.
 *
 * An empty mime (a hand-written card the connector has not stamped yet) gets
 * "Unknown type" rather than a blank — principle 4: say the field is missing
 * instead of rendering nothing where a kind belongs.
 */
export function driveMimeLabel(mime: string): string {
  if (mime === "") return "Unknown type";
  const exact = MIME_LABELS.get(mime);
  if (exact !== undefined) return exact;
  const family = MIME_FAMILY_LABELS.get(mime.split("/")[0] ?? "");
  if (family !== undefined) return family;
  return mime;
}
