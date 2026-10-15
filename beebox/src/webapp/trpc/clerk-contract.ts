/**
 * Clerk wire contract — the SINGLE source of truth for the shape of the clerk
 * tRPC procedures.
 *
 * Self-contained BY DESIGN: this module imports zod and NOTHING else (no fs,
 * git, or landmark graph). That self-containment is load-bearing — it makes
 * this one file's content fully determine the wire shape, which is exactly what
 * the pre-commit staleness gate triggers on and what the generator
 * (`bin/snapshot-clerk-contract.ts`, `pnpm snapshot:clerk-contract`) reads to
 * emit `beebox-clerk/src/contract/clerk-contract.generated.ts`. `clerk.ts`
 * imports these schemas and wires `.input()`/`.output()`; the extension consumes
 * the generated types. Change a field HERE and regenerate — nowhere else.
 */

import { z } from "zod";

export const commentaryInput = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  siteName: z.string().optional(),
  byline: z.string().optional(),
  excerpt: z.string().optional(),
  // The readable rendering of the page (Defuddle markdown), stored in-box.
  readableMarkdown: z.string().min(1),
  // The frozen, self-contained page (SingleFile HTML) — optional attachment.
  frozenHtml: z.string().optional(),
  // Box-relative dir of a landmark commentary destination; omitted → inbox.
  destinationDir: z.string().optional(),
  timestamp: z.string().optional(),
  // Client-generated once per capture and resent unchanged on retry; the box
  // stores it as the webpage card's `capture-id` and replays the existing
  // result instead of writing a second card. Optional so an installed
  // extension built before this field still captures (without dedupe).
  captureId: z.string().uuid().optional(),
});

/** Result of a successful `clerk.commentary` capture. */
export const commentaryOutput = z.object({
  // Box-relative paths written, in commit order.
  created: z.array(z.string()),
  // Companion `open` URL, relative to the box root URL.
  open: z.string(),
});

/**
 * A single landmark commentary destination (mirrors `DestinationInfo`).
 *
 * @public Imported by `bin/snapshot-clerk-contract.ts`, outside this package.
 */
export const commentaryDestination = z.object({
  // Box-relative directory (empty string = box root).
  dir: z.string(),
  label: z.string(),
  // Symbol text (emoji/short text), or null if none / image-only.
  symbol: z.string().nullable(),
});

/** Result of `clerk.commentaryDestinations`. */
export const commentaryDestinationsOutput = z.object({
  destinations: z.array(commentaryDestination),
});

export const tabTransferScope = z.enum(["current-window", "all-windows"]);

const capturedTab = z.object({
  id: z.string().uuid(),
  title: z.string(),
  url: z.string(),
  pinned: z.boolean(),
});

const capturedTabWindow = z.object({
  id: z.string().uuid(),
  tabs: z.array(capturedTab).min(1),
});

export const capturedTabSet = z.object({
  windows: z.array(capturedTabWindow).min(1),
});

const proposedTabWindow = z.object({
  id: z.string().uuid(),
  tabs: z.array(z.string().uuid()).min(1),
});

export const tabArrangementProposal = z.object({
  windows: z.array(proposedTabWindow).min(1),
  close: z.array(z.string().uuid()),
});

/** Payload used both at intake and as the immutable part of the card. */
export const tabArrangementPayload = z.object({
  transferId: z.string().uuid(),
  scope: tabTransferScope,
  capturedAt: z.string().datetime(),
  source: capturedTabSet,
  proposal: tabArrangementProposal,
});

/** Result of accepting a tab arrangement into the box inbox. */
export const tabArrangementOutput = z.object({
  card: z.string(),
  open: z.string(),
  transferId: z.string().uuid(),
});

/**
 * One Send to box: the page, the person's optional note, and the send's id.
 * The id is made once per send and resent unchanged on retry; it is the quick
 * chat record id and the webpage card's `capture-id`.
 */
export const sendInput = z.object({
  id: z.string().uuid(),
  // The person's words; empty when they sent the page with no note.
  note: z.string().trim().max(10000),
  url: z.string().url(),
  title: z.string().min(1),
  siteName: z.string().optional(),
  byline: z.string().optional(),
  excerpt: z.string().optional(),
  readableMarkdown: z.string().min(1),
  frozenHtml: z.string().optional(),
});

/**
 * Where a send stands. A projection of the quick chat view, kept here so this
 * file alone determines the wire shape (see the header).
 */
export const sendOutput = z.object({
  // Box-relative path of the saved webpage card when it was last known.
  card: z.string(),
  state: z.enum(["needs-choice", "sending", "sent", "discarded"]),
  destination: z.object({ label: z.string(), sessionId: z.string().optional() }).optional(),
  queued: z.boolean().optional(),
  reason: z.enum(["uncertain", "routing-unavailable", "destination-gone"]).optional(),
  lastError: z.string().optional(),
  expired: z.literal(true).optional(),
  choices: z.array(z.object({ candidateId: z.string(), label: z.string(), detail: z.string().optional() })).optional(),
});
