// The comment record, as it crosses the wire.
//
// It mirrors the store's schema (`bin/lib/comments-store.ts`) rather than
// importing it: the app does not import across the bin/ package boundary, and
// this is the parse boundary for what the CLI hands back — so it is validated
// here on the way in, not assumed.
//
// `origin` deliberately matches beebox's interactive input
// (`src/frontend/src/input/emission.ts:44` — "typed" | "voice"). This tool does
// not share that schema, but a developer reading both should not hold two words
// for one idea.

import { z } from "zod";

export const commentOriginSchema = z.enum(["typed", "voice"]);

export const commentSchema = z.object({
  id: z.string(),
  at: z.string(),
  origin: commentOriginSchema,
  /** What the boxholder said. */
  body: z.string(),
  /** The selected text, verbatim. Absent for a whole-document comment. */
  quoted: z.string().optional(),
  /** The enclosing heading, as plain text. */
  section: z.string().optional(),
  /** Which workstream this is for; null when nothing has touched the file. */
  workstream: z.string().nullable(),
  /** Where it was written — a different question from `workstream`. */
  worktree: z.string(),
  /** Serialized text fragment, when one could be generated. Best-effort. */
  fragment: z.string().optional(),
});

export const documentCommentsSchema = z.object({
  relPath: z.string(),
  comments: z.array(commentSchema),
});

export type Comment = z.infer<typeof commentSchema>;
export type CommentOrigin = z.infer<typeof commentOriginSchema>;
export type DocumentComments = z.infer<typeof documentCommentsSchema>;
