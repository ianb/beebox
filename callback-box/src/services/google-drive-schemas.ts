/**
 * Inbound zod schemas for the Google Drive / Sheets / Docs REST responses the
 * real {@link createGoogleDriveService} consumes (Track 4b). Narrow — only the
 * fields `google-drive.ts` and the `connectors/drive-*` handlers actually read —
 * and drift-tolerant: unknown keys are ignored (plain `z.object` passthrough,
 * matching `google-gmail-schemas.ts`), so a new Google field can't break a sync.
 * Used via `validateResponse` at each `.json<T>()` boundary.
 */

import { z } from "zod";

const driveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  modifiedTime: z.string(),
  // Explicitly requested in the `fields` param, so Drive returns it on every
  // file — required here rather than optional, since a silently-absent
  // `trashed` would read as "not trashed" and strand a deleted child forever.
  trashed: z.boolean(),
  owners: z
    .array(z.object({ emailAddress: z.string(), displayName: z.string().optional() }))
    .optional(),
  parents: z.array(z.string()).optional(),
  webViewLink: z.string().optional(),
  // Only on `application/vnd.google-apps.shortcut` items.
  shortcutDetails: z
    .object({ targetId: z.string(), targetMimeType: z.string().optional() })
    .optional(),
});

export const driveGetFileSchema = driveFileSchema;

/** Shared by `listFiles` and `listSpreadsheets` — both page `files[]`. */
export const driveFileListSchema = z.object({
  files: z.array(driveFileSchema).optional(),
  nextPageToken: z.string().optional(),
});

export const spreadsheetMetadataSchema = z.object({
  spreadsheetId: z.string(),
  properties: z.object({ title: z.string() }),
  sheets: z.array(
    z.object({
      properties: z.object({ sheetId: z.number(), title: z.string() }),
    }),
  ),
});

// Cells are NOT always strings: Sheets returns raw numbers/booleans for
// unformatted numeric cells (even under FORMULA render for plain values), so a
// strings-only schema would reject a valid spreadsheet (codex finding). The
// service interface's `string[][]` narrowing is the pre-existing cast-site
// contract; the SCHEMA must be a superset of what Google really sends.
export const sheetValuesSchema = z.object({
  values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))).optional(),
});

// ─── Google Docs document (recursive) ────────────────────────────────────────

const documentTextRunSchema = z.object({
  content: z.string().optional(),
  textStyle: z.record(z.string(), z.unknown()).optional(),
  suggestedInsertionIds: z.array(z.string()).optional(),
  suggestedDeletionIds: z.array(z.string()).optional(),
});

const documentParagraphElementSchema = z.object({
  equation: z.unknown().optional(),
  inlineObjectElement: z.object({ inlineObjectId: z.string() }).optional(),
  footnoteReference: z.object({ footnoteId: z.string() }).optional(),
  textRun: documentTextRunSchema.optional(),
});

/**
 * A Docs body is a tree of structural elements. The recursion is genuine: a
 * `table` cell's `content` is itself an array of structural elements, so the
 * schema references itself through {@link z.lazy}. We only model the branches
 * the lossy-content detector walks (paragraphs + table cells); every other
 * structural-element kind (sectionBreak, tableOfContents, …) rides through as
 * ignored extra keys.
 */
const documentStructuralElementSchema: z.ZodType = z.lazy(() =>
  z.object({
    paragraph: z
      .object({ elements: z.array(documentParagraphElementSchema).optional() })
      .optional(),
    table: z
      .object({
        tableRows: z
          .array(
            z.object({
              tableCells: z
                .array(z.object({ content: z.array(documentStructuralElementSchema).optional() }))
                .optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  }),
);

export const documentStructureSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  // Google omits revisionId when the caller lacks edit access (read-only
  // share); a comment-only doc must still validate (codex finding). Consumers
  // already treat revision as best-effort.
  revisionId: z.string().optional(),
  body: z.object({ content: z.array(documentStructuralElementSchema).optional() }).optional(),
  inlineObjects: z.record(z.string(), z.unknown()).optional(),
  footnotes: z.record(z.string(), z.unknown()).optional(),
});

// ─── Comments ─────────────────────────────────────────────────────────────────

const driveCommentSchema = z.object({
  id: z.string(),
  content: z.string(),
  author: z.object({ displayName: z.string().optional(), emailAddress: z.string().optional() }).optional(),
  resolved: z.boolean().optional(),
});

export const driveCommentListSchema = z.object({
  comments: z.array(driveCommentSchema).optional(),
  nextPageToken: z.string().optional(),
});
