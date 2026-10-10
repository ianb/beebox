// The exhibits contract shared by the server, the container, and store pages.
//
// An exhibit is a directory in the store carrying a manifest, content files,
// and captured interactions. See docs/exhibits.md for the page contract and
// beebox/docs/plans/exhibits-rethink.md for why there is no ask.

import { z } from "zod";

export const MANIFEST_FILE = "exhibit.json";
export const DOC_FILE = "doc.md";

export const figureSchema = z.object({
  label: z.string().min(1),
  file: z.string().min(1),
  caption: z.string().min(1).optional(),
});

/**
 * One manifest shape for workstream exhibits and committed apps. `prose` is a
 * short Markdown paragraph the page shows above the figures.
 */
export const exhibitManifestSchema = z.object({
  title: z.string().min(1),
  created: z.string().min(1),
  prose: z.string().min(1).optional(),
  figures: z.array(figureSchema).min(1).optional(),
});

export type ExhibitFigure = z.infer<typeof figureSchema>;
export type ExhibitManifest = z.infer<typeof exhibitManifestSchema>;

/**
 * One workstream exhibit as the dashboard lists it. The inventory is a read of
 * the files the exhibits origin serves, so a row can describe an exhibit whose
 * manifest does not parse: `title` and `created` are null and `problem` is set
 * rather than the row vanishing (engineering principle 4).
 */
export const exhibitInventoryEntrySchema = z.object({
  workstream: z.string(),
  slug: z.string(),
  /** Path on the exhibits origin, joined to the inventory's `origin`. */
  path: z.string(),
  title: z.string().nullable(),
  created: z.string().nullable(),
  problem: z.string().nullable(),
});

export const exhibitInventorySchema = z.object({
  /** Origin of the exhibits listener, e.g. `http://127.0.0.1:3230`. */
  origin: z.string(),
  /** Set when the store itself could not be read at all. */
  storeProblem: z.string().nullable(),
  entries: z.array(exhibitInventoryEntrySchema),
});

export type ExhibitInventoryEntry = z.infer<typeof exhibitInventoryEntrySchema>;
export type ExhibitInventory = z.infer<typeof exhibitInventorySchema>;

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
