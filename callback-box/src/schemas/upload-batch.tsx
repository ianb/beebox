/**
 * Upload-batch card schema (Phase-2 frontmatter + short summary body).
 *
 * Written by the bulk-upload preparation worker
 * (`src/core/bulk-upload/prepare.ts`) when a bulk file-upload batch is landed
 * under a chat's `tmp-upload/` and delivered as an `<upload>` message. Unlike a
 * capture-session card there is NO transcript body — the body is a short
 * generated summary the agent may overwrite with its own filing notes. The
 * uploaded blobs live in the card's attach scope (`{basename}.attach/`), tracked
 * by that scope's `manifest.json` per `docs/asset-manifests.md`.
 *
 * The chat agent — not a background procedure — files these batches; see
 * `instructions` below. There is deliberately no terminal `filed`/`done`
 * status: a fully-filed batch is *deleted* (card + attach dir removed), so the
 * only lifecycle is `new` → `delivered`, and the card's mere existence means
 * "still has files to place."
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, splitCardContent, type CardSchema } from "../cards/index.js";

/**
 * `new` (written by preparation, not yet delivered) → `delivered` (the
 * `<upload>` chat message was sent). No terminal status: a fully-filed batch is
 * deleted, not marked done.
 */
const UploadBatchStatusSchema = z.enum(["new", "delivered"]);
export type UploadBatchStatus = z.infer<typeof UploadBatchStatusSchema>;

const BatchTime = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }).optional(),
});

/** Tally of the batch's registered items across the three outcomes. */
const BatchCounts = z.object({
  registered: z.number(),
  received: z.number(),
  missing: z.number(),
  failed: z.number(),
});

/** A file whose bytes arrived. `size` is server-computed; `mimetype` is client-claimed. */
const ReceivedItem = z.object({
  name: z.string(),
  size: z.number(),
  mimetype: z.string().optional(),
});

/** A registered item whose bytes never arrived (name is client-claimed). */
const MissingItem = z.object({
  name: z.string(),
});

/** A registered item the uploader reported as failed, with the client-reported reason. */
const FailedItem = z.object({
  name: z.string(),
  reason: z.string(),
});

const uploadBatchFields = {
  status: UploadBatchStatusSchema.default("new"),
  "batch-id": z.string(),
  /**
   * The chat session this batch was uploaded into, persisted at prepare time so
   * the unfiled-batch sweep notifies the ORIGINAL target chat (not a chat
   * reconstructed from the context dir's most-recent history entry). Optional:
   * legacy cards predate it and fall back to the most-active session.
   */
  "target-session": z.string().optional(),
  /**
   * Set once the unfiled-batch sweep has surfaced this batch as a self-note, so
   * it notifies at most once ever (rather than re-firing every sweep cycle).
   */
  "sweep-notified": z.string().optional(),
  time: BatchTime.optional(),
  counts: BatchCounts,
  /** Server-computed sum of every received file's size, in bytes. */
  "total-bytes": z.number(),
  /** Files whose bytes arrived (name + server-computed size + client-claimed mimetype). */
  received: z.array(ReceivedItem).optional(),
  /** Registered items that never arrived (name only). */
  missing: z.array(MissingItem).optional(),
  /** Items the uploader reported failing, with the reason. */
  failed: z.array(FailedItem).optional(),
  /**
   * The boxholder's own words introducing this batch — the composer text they
   * submitted the files with. Verbatim user input (neither server-computed nor
   * client-guessed). Absent when they submitted the batch with an empty
   * composer, which is the case duty 1 tells the agent to ask about.
   */
  note: z.string().optional(),
  /** Short generated summary; the agent may overwrite it with filing notes. */
  body: body(z.string()),
};

export const UploadBatchSchema: CardSchema = cardSchema("upload-batch", {
  description: "A bulk file-upload batch landed under a chat's tmp-upload/, awaiting the agent to file each file to its destination",
  category: "synced",
  searchable: true,
  fields: uploadBatchFields,
  instructions: `# Upload Batch Cards

A bulk upload is a batch of files the boxholder dropped into a box at once
(camera-roll batches, document folders — order of dozens of items / ~100 MB).
It is delivered to chat as an \`<upload doc="..." files="N" bytes="..." failed="M">\`
message — **first-class user input, exactly like a \`<capture>\`, and a reply is
expected.** The card groups the whole batch; every uploaded file lives in the
card's attach scope (\`{basename}.attach/\`), inventoried by that scope's
\`manifest.json\`.

The card lands under \`tmp-upload/<batch-slug>/\` inside the chat's context dir —
a landing zone, not storage (a sibling of capture's \`tmp-capture/\`).

Frontmatter:
- \`status\` — \`new\` (just written) → \`delivered\` (the chat message went out).
  There is no "filed" status: a fully-filed batch is **deleted**, so a card that
  still exists still has files to place.
- \`batch-id\` — the batch's landing slug.
- \`time\` — \`{ start, end? }\`.
- \`counts\` — \`{ registered, received, missing, failed }\` item tallies.
- \`total-bytes\` — server-computed sum of the received files' sizes.
- \`received\` — files whose bytes arrived: \`name\` (the stored filename, on disk
  and in the attach manifest), \`size\` (**server-computed**), \`mimetype\`
  (**client-claimed** — the browser's guess, may be wrong).
- \`missing\` — registered items that never arrived (\`name\` only; **client-claimed**).
- \`failed\` — items the uploader reported failing, with a \`reason\`.
- \`note\` — **the boxholder's own words**, typed in the composer when they sent
  the batch. This is the batch's introduction: what these files are, or where
  they should go. Often absent.

**Server-computed vs client-claimed:** sizes and content hashes (in the attach
manifest) are computed here from the actual bytes and are trustworthy. Original
filenames and mimetypes are claimed by the client and may lie — **trust the
bytes over a claimed mimetype when they disagree.**

Body — a short generated summary. It is yours to overwrite with filing notes;
nothing regenerates it.

**Your duties on an upload-batch card, in order:**

1. **If the batch arrived without introduction, ask first — don't file.** When
   there's no accompanying message explaining what these files are or where they
   go, ask the boxholder before operating on them. Only file unprompted when the
   destination is genuinely unambiguous.

   **A batch WITH an introduction is not that case** — when \`note\` is set (it
   also appears at the top of the \`<upload>\` message body), the boxholder has
   already told you what these files are. Act on what they said instead of asking
   them to repeat it. Ask only about what their introduction genuinely leaves
   open, the way you would about any other request.

2. **Read the card and its attach manifest**, then **trust the directory listing
   over the manifest if they disagree** (someone may have hand-moved a file).
   Inspect files as needed to understand them.

3. **File each file, or a coherent group, to its destination:** a destination
   card's attach scope (via the asset-manifest tooling), \`store/\`, or
   \`box/inbox/\`. Use the file-level tools that actually exist — \`git mv\` for
   tracked files, attach-scope blobs move via the manifest helpers, and \`cb mv\`
   only for cards/directories (it refuses loose files). Shrink the card's
   \`received\`/\`missing\`/\`failed\` lists as you place things, and **delete the card
   and its attach dir once everything is placed.**

4. **\`tmp-upload/\` must not accumulate.** A batch left there is unfinished work.
   If you can't finish in one turn, say so and come back to it — don't leave it
   silently. A batch you go to file and find already **missing** was already
   filed: that's done, not an error — no error theater.`,
});

/** Frontmatter-only object schema (the summary body lives outside Zod). */
const UploadBatchObject = z.object({
  status: UploadBatchStatusSchema.default("new"),
  "batch-id": z.string(),
  "target-session": z.string().optional(),
  "sweep-notified": z.string().optional(),
  time: BatchTime.optional(),
  counts: BatchCounts,
  "total-bytes": z.number(),
  received: z.array(ReceivedItem).optional(),
  missing: z.array(MissingItem).optional(),
  failed: z.array(FailedItem).optional(),
  note: z.string().optional(),
});
export type UploadBatchFrontmatter = z.infer<typeof UploadBatchObject>;

/** An upload-batch card's parsed frontmatter plus its summary body, or null if
 * the text has no frontmatter / fails validation. */
export interface ParsedUploadBatch {
  frontmatter: UploadBatchFrontmatter;
  body: string;
}

export function parseUploadBatch(content: string): ParsedUploadBatch | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    return null;
  }
  const parsed = UploadBatchObject.safeParse(fm ?? {});
  if (!parsed.success) return null;
  return { frontmatter: parsed.data, body: split.body };
}

export interface UploadBatchReceived {
  name: string;
  size: number;
  mimetype?: string;
}

/**
 * Build an upload-batch card. `received`/`missing`/`failed` are the
 * server-computed batch summary; `summary` is the short body prose; `note` is
 * the boxholder's verbatim introduction. Empty lists and an absent note are
 * omitted from the frontmatter.
 */
export function createUploadBatchTemplate(options: {
  batchId: string;
  /** The chat session this batch was uploaded into (for the unfiled sweep's self-note). */
  targetSessionId?: string | null;
  startedAt: string;
  endedAt?: string | null;
  registered: number;
  totalBytes: number;
  received: UploadBatchReceived[];
  missing: string[];
  failed: Array<{ name: string; reason: string }>;
  summary: string;
  /** The boxholder's verbatim introduction, when the batch carried one. */
  note?: string | undefined;
}): string {
  const time: Record<string, string> = { start: options.startedAt };
  if (options.endedAt) time.end = options.endedAt;

  const fields: Record<string, unknown> = {
    status: "new",
    "batch-id": options.batchId,
    ...(options.targetSessionId ? { "target-session": options.targetSessionId } : {}),
    time,
    counts: {
      registered: options.registered,
      received: options.received.length,
      missing: options.missing.length,
      failed: options.failed.length,
    },
    "total-bytes": options.totalBytes,
  };
  if (options.received.length > 0) {
    fields.received = options.received.map((r) => {
      const entry: Record<string, unknown> = { name: r.name, size: r.size };
      if (r.mimetype !== undefined) entry.mimetype = r.mimetype;
      return entry;
    });
  }
  if (options.missing.length > 0) fields.missing = options.missing.map((name) => ({ name }));
  if (options.failed.length > 0) fields.failed = options.failed.map((f) => ({ name: f.name, reason: f.reason }));
  if (options.note !== undefined && options.note !== "") fields.note = options.note;

  return `---\n${stringifyYaml(fields)}---\n${options.summary}\n`;
}
