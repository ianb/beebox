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
