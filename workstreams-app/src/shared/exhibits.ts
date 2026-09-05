// The exhibits contract shared by the server, the container, and store pages.
//
// An exhibit is a directory in the store carrying a manifest, content files,
// and (later) captured interactions. See docs/exhibits.md for the page contract
// and beebox/docs/plans/workstream-exhibits.md for the vocabulary.

import { z } from "zod";

export const MANIFEST_FILE = "exhibit.json";
export const DOC_FILE = "doc.md";

export const askTypes = ["decide", "confirm", "react", "fyi"] as const;
export type AskType = (typeof askTypes)[number];

export const askTypeLabels: Record<AskType, string> = {
  decide: "Decide",
  confirm: "Confirm",
  react: "React",
  fyi: "FYI",
};

export const askSchema = z.object({
  type: z.enum(askTypes),
  prose: z.string().min(1),
  options: z.array(z.string().min(1)).min(1).optional(),
});

export const figureSchema = z.object({
  label: z.string().min(1),
  file: z.string().min(1),
  caption: z.string().min(1).optional(),
});

/** A workstream exhibit always states its ask: it is presented to be answered. */
export const exhibitManifestSchema = z.object({
  title: z.string().min(1),
  ask: askSchema,
  created: z.string().min(1),
  figures: z.array(figureSchema).min(1).optional(),
});

/** A committed app is a durable tool, not a question, so its ask is optional. */
export const appManifestSchema = exhibitManifestSchema.extend({
  ask: askSchema.optional(),
});

export type ExhibitAsk = z.infer<typeof askSchema>;
export type ExhibitFigure = z.infer<typeof figureSchema>;
export type ExhibitManifest = z.infer<typeof appManifestSchema>;

/**
 * The developer's answer, written by the renderer as the document
 * `data/disposition.json`. Dispositions are not a special primitive: agents and
 * the ask queue read this file from disk like any other exhibit data.
 */
export const DISPOSITION_KEY = "disposition";

export const dispositionSchema = z.object({
  askType: z.enum(askTypes),
  /** The chosen option (decide) or verdict (confirm); absent for react/fyi. */
  choice: z.string().min(1).optional(),
  comment: z.string().min(1).optional(),
  decidedAt: z.string().min(1),
});

export type ExhibitDisposition = z.infer<typeof dispositionSchema>;

/**
 * One row of the workstreams app's "waiting on you" queue (Track E). The queue
 * is a read of the same files the exhibits origin serves, so a row can describe
 * an exhibit whose manifest does not parse: `problem` is set and `ask` is null
 * rather than the row vanishing (engineering principle 4).
 */
export const askQueueEntrySchema = z.object({
  /** The store workstream directory, or `apps` for a committed app. */
  workstream: z.string(),
  slug: z.string(),
  /** Path on the exhibits origin, joined to the queue's `origin`. */
  path: z.string(),
  /** A committed app: tracked in the main checkout, outlives every workstream. */
  permanent: z.boolean(),
  title: z.string().nullable(),
  ask: askSchema.nullable(),
  answered: z.boolean(),
  decidedAt: z.string().nullable(),
  /** A broken manifest or an unreadable disposition, phrased for the developer. */
  problem: z.string().nullable(),
});

export const askQueueSchema = z.object({
  /** Origin of the exhibits listener, e.g. `http://127.0.0.1:3230`. */
  origin: z.string(),
  /** Set when the store itself could not be read at all. */
  storeProblem: z.string().nullable(),
  entries: z.array(askQueueEntrySchema),
});

export type AskQueueEntry = z.infer<typeof askQueueEntrySchema>;
export type AskQueue = z.infer<typeof askQueueSchema>;

/**
 * One safe path segment. Every route parameter that becomes a path component is
 * validated with this before it is joined to a root: no separators, no
 * traversal, no dotfiles (the store marker and any future metadata stay
 * unreachable through routing).
 */
export const exhibitSegmentSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

/** What the server hands the container to render one exhibit. */
export interface ExhibitBoot {
  /** `<workstream>/<exhibit>` or `apps/<name>` — the Track C API scope. */
  scope: string;
  listUrl: string;
  listLabel: string;
  manifest: ExhibitManifest;
  doc: string | null;
  /** `/@fs/<abs>/index.tsx` when the exhibit overrides the default renderer. */
  module: string | null;
}
