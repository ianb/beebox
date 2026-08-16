// The exhibits contract shared by the server, the container, and store pages.
//
// An exhibit is a directory in the store carrying a manifest, content files,
// and (later) captured interactions. See docs/exhibits.md for the page contract
// and callback-box/docs/plans/workstream-exhibits.md for the vocabulary.

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
