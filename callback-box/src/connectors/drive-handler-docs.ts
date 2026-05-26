/**
 * Drive type handler for Google Docs.
 *
 * Exports the document body as markdown inside the card's attach scope
 * (`<basename>.attach/<basename>.md`). On push, replaces the upstream
 * content with the local markdown.
 *
 * Conflict detection: stores `headRevisionId` and `modifiedTime` after each
 * successful pull. Before pushing, re-reads remote state — if either has
 * changed, refuses to push, sets card status="conflict", and writes the
 * upstream version to `<basename>.remote.md` inside the attach scope for
 * manual merge.
 *
 * Lossy detection: walks the Docs API structure to count features that
 * don't survive markdown export (comments, footnotes, embedded images,
 * drawings, equations, unresolved suggestions, complex tables). Surfaces
 * the counts in the card's `<lossy>` block.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  DriveTypeHandler,
  InspectResult,
  PullResult,
  PushResult,
} from "./drive-types.js";
import { registerDriveHandler } from "./drive-types.js";
import type {
  GoogleDriveService,
  DriveFile,
  DocumentStructure,
} from "../services/google-drive.js";
import { createGdocTemplate } from "../schemas/gdoc.js";
import type { GdocLossyType } from "../schemas/gdoc.js";

const DOC_MIME = "application/vnd.google-apps.document";
const MARKDOWN_MIME = "text/markdown";

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

interface LossyCounts {
  comments: number;
  footnotes: number;
  images: number;
  drawings: number;
  equations: number;
  suggestions: number;
  tables: number;
}

function emptyLossy(): LossyCounts {
  return {
    comments: 0,
    footnotes: 0,
    images: 0,
    drawings: 0,
    equations: 0,
    suggestions: 0,
    tables: 0,
  };
}

/**
 * Walk a fetched Docs API document and tally features that don't round-trip
 * through markdown export. Comment count is added separately by the caller
 * (comments live on the Drive API, not the Docs API).
 */
function tallyLossyFromDocument(doc: DocumentStructure): LossyCounts {
  const counts = emptyLossy();

  // Inline objects are images and drawings. Drawings have an
  // `embeddedDrawingProperties` field on their inline object metadata; we
  // don't pull that here, so just count everything as `images` for now.
  // (Splitting images vs drawings would need a second pass over inlineObjects.)
  if (doc.inlineObjects) {
    counts.images = Object.keys(doc.inlineObjects).length;
  }

  if (doc.footnotes) {
    counts.footnotes = Object.keys(doc.footnotes).length;
  }

  const seenSuggestions = new Set<string>();
  for (const block of doc.body?.content ?? []) {
    if (block.table !== undefined) {
      counts.tables += 1;
    }
    if (!block.paragraph) continue;
    for (const el of block.paragraph.elements ?? []) {
      if (el.equation !== undefined) counts.equations += 1;
      const run = el.textRun;
      if (run) {
        for (const id of run.suggestedInsertionIds ?? []) seenSuggestions.add(id);
        for (const id of run.suggestedDeletionIds ?? []) seenSuggestions.add(id);
      }
    }
  }
  counts.suggestions = seenSuggestions.size;

  return counts;
}

function lossyToTemplateItems(
  counts: LossyCounts,
): Array<{ type: GdocLossyType; count: number }> {
  const items: Array<{ type: GdocLossyType; count: number }> = [];
  for (const key of Object.keys(counts) as Array<keyof LossyCounts>) {
    if (counts[key] > 0) items.push({ type: key, count: counts[key] });
  }
  return items;
}

/**
 * Call `getDocument`, but degrade gracefully if the auth token lacks the
 * `documents.readonly` scope (HTTP 403). Returns null on failure so the
 * caller can keep pulling with reduced fidelity (no revisionId for
 * conflict detection, lossy detection limited to comment count).
 */
async function tryGetDocument(
  service: GoogleDriveService,
  opts: { fileId: string; fileName: string },
): Promise<DocumentStructure | null> {
  try {
    return await service.getDocument(opts.fileId);
  } catch (e) {
    const msg = (e as Error).message;
    console.warn(
      "[google-drive] Could not fetch Docs API metadata for " +
        opts.fileName + ": " + msg +
        ". If this is a 403, run 'cb google-auth' to grant the documents.readonly scope.",
    );
    return null;
  }
}

const docsHandler: DriveTypeHandler = {
  mimeTypes: [DOC_MIME],
  cardType: "gdoc",

  async inspect(file: DriveFile, service: GoogleDriveService): Promise<InspectResult> {
    const [doc, comments] = await Promise.all([
      service.getDocument(file.id),
      service.listComments(file.id),
    ]);
    const lossy = tallyLossyFromDocument(doc);
    lossy.comments = comments.length;

    return {
      title: doc.title,
      mimeType: file.mimeType,
      owner: file.owners?.[0]?.emailAddress ?? "unknown",
      modifiedTime: file.modifiedTime,
      details: { revisionId: doc.revisionId, lossy },
    };
  },

  async pull(opts): Promise<PullResult> {
    const { file, cardPath, localDir, boxRoot, service, state } = opts;
    const written: string[] = [];
    let changed = false;

    const cardBasename = path.basename(cardPath, ".gdoc.card");
    const mdFilename = `${cardBasename}.md`;
    const mdPath = path.join(localDir, mdFilename);
    // mdRelPath is the key used in state.contentHashes and the card's content ref
    // (always written as "<basename>.md" — the bare filename within the attach scope).
    const mdRelPath = mdFilename;

    // Fetch upstream state in parallel. `getDocument` requires the
    // `documents.readonly` scope; if it's missing we still want pull to
    // succeed with reduced fidelity (no revisionId, no lossy details
    // beyond the comment count).
    const [doc, comments, markdown] = await Promise.all([
      tryGetDocument(service, { fileId: file.id, fileName: file.name }),
      service.listComments(file.id),
      service.exportFile(file.id, MARKDOWN_MIME),
    ]);

    const lossy = doc ? tallyLossyFromDocument(doc) : emptyLossy();
    lossy.comments = comments.length;

    const newHash = contentHash(markdown);
    const storedHash = state.contentHashes[mdRelPath];

    if (storedHash === undefined) {
      // First pull.
      await fs.mkdir(localDir, { recursive: true });
      await fs.writeFile(mdPath, markdown);
      state.contentHashes[mdRelPath] = newHash;
      written.push(path.relative(boxRoot, mdPath));
      changed = true;
    } else {
      let localContent = "";
      try {
        localContent = await fs.readFile(mdPath, "utf-8");
      } catch {
        // File missing — treat as no local edit, will be written below
      }
      const localHash = contentHash(localContent);
      if (localHash === storedHash && newHash !== storedHash) {
        // No local edit + remote changed → safe to overwrite.
        await fs.writeFile(mdPath, markdown);
        state.contentHashes[mdRelPath] = newHash;
        written.push(path.relative(boxRoot, mdPath));
        changed = true;
      }
      // Else: local edit (push handles it) or nothing changed.
    }

    // Update remote-tracking state. modifiedTime is always available;
    // revisionId only when `getDocument` succeeded.
    state.lastModified = file.modifiedTime;
    if (doc) {
      state.extra["headRevisionId"] = doc.revisionId;
    } else {
      delete state.extra["headRevisionId"];
    }

    // Determine card status: keep `conflict` if push set it on a previous
    // sync and there's still a `.remote.md` file. Otherwise `synced`.
    const remoteMdPath = path.join(localDir, `${cardBasename}.remote.md`);
    let hasRemoteFile = false;
    try {
      await fs.access(remoteMdPath);
      hasRemoteFile = true;
    } catch {
      // No conflict file
    }

    // Build (or rebuild) the card. Fall back to Drive metadata if the
    // Docs API call failed (no title/revisionId in that case).
    const owner = file.owners?.[0]?.emailAddress ?? "unknown";
    const link = file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`;
    const cardContent = createGdocTemplate({
      driveId: file.id,
      title: doc ? doc.title : file.name,
      modified: file.modifiedTime,
      revision: doc ? doc.revisionId : "",
      link,
      owner,
      contentFile: mdRelPath,
      lossy: lossyToTemplateItems(lossy),
      status: hasRemoteFile ? "conflict" : "synced",
    });

    let existingCard = "";
    try {
      existingCard = await fs.readFile(cardPath, "utf-8");
    } catch {
      // New card
    }
    if (cardContent !== existingCard) {
      await fs.mkdir(path.dirname(cardPath), { recursive: true });
      await fs.writeFile(cardPath, cardContent);
      written.push(path.relative(boxRoot, cardPath));
      changed = true;
    }

    return { written, changed };
  },

  async push(opts): Promise<PushResult> {
    const { file, cardPath, localDir, boxRoot, service, state } = opts;
    const pushed: string[] = [];

    const cardBasename = path.basename(cardPath, ".gdoc.card");
    const mdFilename = `${cardBasename}.md`;
    const mdPath = path.join(localDir, mdFilename);
    const mdRelPath = mdFilename;

    let localContent: string;
    try {
      localContent = await fs.readFile(mdPath, "utf-8");
    } catch {
      // Nothing to push.
      return { pushed: [] };
    }

    const localHash = contentHash(localContent);
    const storedHash = state.contentHashes[mdRelPath];
    if (storedHash === undefined) {
      // First sync — pull will create the file and store the hash.
      return { pushed: [] };
    }
    if (localHash === storedHash) {
      // No local change.
      return { pushed: [] };
    }

    // If a previous sync left an unresolved conflict, don't push until the
    // user resolves and deletes `.remote.md`.
    const remoteMdPath = path.join(localDir, `${cardBasename}.remote.md`);
    try {
      await fs.access(remoteMdPath);
      console.warn(
        `[google-drive] Skipping push for ${file.name}: unresolved conflict (${cardBasename}.remote.md exists)`,
      );
      return { pushed: [] };
    } catch {
      // No conflict file — proceed with conflict check below.
    }

    // Conflict check: re-read remote state, ensure it matches what we
    // recorded on the last pull. If anything diverged → don't push, write
    // the upstream content alongside as `.remote.md`. The pull that runs
    // immediately after this push will see the file and set the card's
    // status to `conflict`.
    //
    // Both signals are best-effort: revisionId only kicks in when both the
    // stored and current values are available (Docs API scope present at
    // both pull-time and push-time). modifiedTime always works.
    const storedRevision = state.extra["headRevisionId"] as string | undefined;
    const doc = await tryGetDocument(service, { fileId: file.id, fileName: file.name });
    const remoteDiverged =
      file.modifiedTime !== state.lastModified ||
      (storedRevision !== undefined && doc !== null && doc.revisionId !== storedRevision);

    if (remoteDiverged) {
      const remoteMarkdown = await service.exportFile(file.id, MARKDOWN_MIME);
      await fs.writeFile(remoteMdPath, remoteMarkdown);
      pushed.push(path.relative(boxRoot, remoteMdPath));
      console.warn(
        `[google-drive] Conflict on ${file.name}: remote changed since last pull. ` +
          `Wrote upstream to ${cardBasename}.remote.md`,
      );
      return { pushed };
    }

    // Safe to push.
    await service.updateFileContent(file.id, {
      mimeType: MARKDOWN_MIME,
      content: localContent,
    });

    state.contentHashes[mdRelPath] = localHash;
    pushed.push(path.relative(boxRoot, mdPath));
    return { pushed };
  },
};

registerDriveHandler(docsHandler);

export { docsHandler };
