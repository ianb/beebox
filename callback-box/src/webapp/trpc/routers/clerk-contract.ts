/**
 * Clerk wire contract — the SINGLE source of truth for the shape of the two
 * clerk tRPC procedures (`clerk.commentary`, `clerk.commentaryDestinations`).
 *
 * Self-contained BY DESIGN: this module imports zod and NOTHING else (no fs,
 * git, or landmark graph). That self-containment is load-bearing — it makes
 * this one file's content fully determine the wire shape, which is exactly what
 * the pre-commit staleness gate triggers on and what the generator
 * (`bin/snapshot-clerk-contract.ts`, `pnpm snapshot:clerk-contract`) reads to
 * emit `callback-clerk/src/contract/clerk-contract.generated.ts`. `clerk.ts`
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

/** A single landmark commentary destination (mirrors `DestinationInfo`). */
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
