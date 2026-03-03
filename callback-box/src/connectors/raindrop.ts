/**
 * Raindrop.io Connector - Two-way bookmark sync.
 *
 * Push phase: detect locally-changed bookmark cards, POST/PUT to Raindrop API.
 * Pull phase: paginate all remote bookmarks, create/update/remove local cards.
 *
 * Config (secret) in config/connectors/raindrop.secret.json:
 * { "token": "..." }
 *
 * State in config/connectors/raindrop-state.json:
 * { lastSyncTime, collections, bookmarks: { [raindropId]: { cardPath, lastSyncedHash, ... } } }
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { parseXml, type ElementNode } from "cardworks";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { createBookmarkTemplate } from "../schemas/bookmark.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import { createOrAppendIntakeJob } from "./intake-utils.js";
import { saveTransientState } from "./transient-state.js";
import { safeFilename } from "./chat-utils.js";
import type { RaindropService } from "../services/raindrop.js";
import { createRaindropService } from "../services/raindrop.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RaindropConfig {
  token: string;
}

interface BookmarkFields {
  title: string;
  link: string;
  note: string;
  tags: string[];
  collection: string;
}

interface BookmarkSyncEntry {
  cardPath: string;
  lastSyncedHash: string;
  raindropUpdated: string;
  syncedFields: BookmarkFields;
  title?: string;
}

interface RaindropState {
  collections: Record<string, number>; // name → id
  bookmarks: Record<string, BookmarkSyncEntry>; // raindropId → entry
}

interface RaindropBookmark {
  _id: number;
  title: string;
  link: string;
  excerpt: string;
  note: string;
  tags: string[];
  created: string;
  lastUpdate: string;
  collection: { $id: number };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function computeContentHash(fields: BookmarkFields): string {
  const normalized = JSON.stringify({
    title: fields.title.trim(),
    link: fields.link.trim(),
    note: fields.note.trim(),
    tags: [...fields.tags].toSorted(),
    collection: fields.collection.trim(),
  });
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Parameters for computeFieldDiff
 */
interface ComputeFieldDiffParams {
  current: BookmarkFields;
  synced: BookmarkFields;
  collectionMap: Record<string, number>;
}

function computeFieldDiff(
  params: ComputeFieldDiffParams
): Partial<{
  title: string;
  link: string;
  tags: string[];
  note: string;
  collection: { $id: number };
}> {
  const { current, synced, collectionMap } = params;
  const diff: Partial<{
    title: string;
    link: string;
    tags: string[];
    note: string;
    collection: { $id: number };
  }> = {};
  if (current.title !== synced.title) diff.title = current.title;
  if (current.link !== synced.link) diff.link = current.link;
  if (current.note !== synced.note) diff.note = current.note;
  if (JSON.stringify([...current.tags].toSorted()) !== JSON.stringify([...synced.tags].toSorted())) {
    diff.tags = current.tags;
  }
  if (current.collection !== synced.collection) {
    const collId = collectionMap[current.collection] ?? -1;
    diff.collection = { $id: collId };
  }
  return diff;
}



/** Extract sync-relevant fields from a parsed bookmark card. */
function extractFieldsFromCard(root: ElementNode): BookmarkFields {
  let title = "";
  let link = "";
  let note = "";
  const tags: string[] = [];
  const collection = root.attrs["collection"] || "Unsorted";

  for (const child of root.children) {
    switch (child.tagName) {
      case "title":
        title = child.text || "";
        break;
      case "link":
        link = child.text || "";
        break;
      case "note":
        note = child.text || "";
        break;
      case "tags":
        for (const tagChild of child.children) {
          if (tagChild.tagName === "tag" && tagChild.text) {
            tags.push(tagChild.text);
          }
        }
        break;
    }
  }

  return { title, link, note, tags, collection };
}

/** Extract all fields (including informational) from a parsed bookmark card. */
function extractAllFromCard(root: ElementNode): {
  fields: BookmarkFields;
  raindropId?: string;
  excerpt?: string;
  created?: string;
  updated?: string;
} {
  const fields = extractFieldsFromCard(root);
  let excerpt: string | undefined;
  let created: string | undefined;
  let updated: string | undefined;

  for (const child of root.children) {
    switch (child.tagName) {
      case "excerpt":
        excerpt = child.text;
        break;
      case "created":
        created = child.text;
        break;
      case "updated":
        updated = child.text;
        break;
    }
  }

  const result: {
    fields: BookmarkFields;
    raindropId?: string;
    excerpt?: string;
    created?: string;
    updated?: string;
  } = { fields };

  const rid = root.attrs["raindrop-id"];
  if (rid) result.raindropId = rid;
  if (excerpt) result.excerpt = excerpt;
  if (created) result.created = created;
  if (updated) result.updated = updated;

  return result;
}

/**
 * Parameters for buildBookmarkCard
 */
interface BuildBookmarkCardParams {
  rb: RaindropBookmark;
  id: string;
  collName: string;
}

/** Build a bookmark card from a Raindrop API response. */
function buildBookmarkCard(params: BuildBookmarkCardParams): string {
  const { rb, id, collName } = params;
  const opts: Parameters<typeof createBookmarkTemplate>[0] = {
    title: rb.title,
    link: rb.link,
    raindropId: id,
    collection: collName,
    created: rb.created,
    updated: rb.lastUpdate,
  };
  if (rb.excerpt) opts.excerpt = rb.excerpt;
  if (rb.note) opts.note = rb.note;
  if (rb.tags && rb.tags.length > 0) opts.tags = rb.tags;
  return createBookmarkTemplate(opts);
}

// ─── Commit Message Builders ─────────────────────────────────────────────────

interface PushNote {
  title: string;
  collection: string;
  isNew: boolean;
}

interface PullNote {
  action: "new" | "updated" | "removed";
  title: string;
  collection?: string;
}

function buildRaindropPushMessage(notes: PushNote[]): string {
  const subject = `Push ${notes.length} bookmark${notes.length === 1 ? "" : "s"} to Raindrop`;
  if (notes.length === 0) return subject;

  const lines = [subject, ""];
  const cap = 5;
  for (const n of notes.slice(0, cap)) {
    lines.push(`- "${n.title}" (${n.collection})`);
  }
  if (notes.length > cap) {
    lines.push(`  + ${notes.length - cap} more`);
  }
  return lines.join("\n");
}

function buildRaindropPullMessage(notes: PullNote[]): string {
  const newNotes = notes.filter((n) => n.action === "new");
  const updatedNotes = notes.filter((n) => n.action === "updated");
  const removedNotes = notes.filter((n) => n.action === "removed");

  const parts: string[] = [];
  if (newNotes.length > 0) parts.push(`${newNotes.length} new`);
  if (updatedNotes.length > 0) parts.push(`${updatedNotes.length} updated`);
  if (removedNotes.length > 0) parts.push(`${removedNotes.length} removed`);
  const subject = `Pull ${parts.join(", ")} bookmark${notes.length === 1 ? "" : "s"} from Raindrop`;

  if (notes.length === 0) return subject;

  const lines = [subject, ""];
  const cap = 5;

  const sections: [string, PullNote[]][] = [
    ["New", newNotes],
    ["Updated", updatedNotes],
    ["Removed", removedNotes],
  ];

  for (const [label, sectionNotes] of sections) {
    if (sectionNotes.length === 0) continue;
    lines.push(`${label}:`);
    for (const n of sectionNotes.slice(0, cap)) {
      const coll = n.collection ? ` (${n.collection})` : "";
      lines.push(`- "${n.title}"${coll}`);
    }
    if (sectionNotes.length > cap) {
      lines.push(`  + ${sectionNotes.length - cap} more`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ─── Connector ──────────────────────────────────────────────────────────────

class RaindropConnector implements Connector {
  name = "raindrop";
  produces = ["bookmark"];
  triggeredBy?: string;

  private boxRoot: string;
  private raindropService: RaindropService | undefined;

  constructor(boxRoot: string, raindropService?: RaindropService) {
    this.boxRoot = boxRoot;
    this.raindropService = raindropService;
  }

  /** Get the Raindrop service, using injected service or creating from token. */
  private getRaindrop(token: string): RaindropService {
    return this.raindropService ?? createRaindropService(token);
  }

  private configPath(): string {
    return path.join(this.boxRoot, "config/connectors/raindrop.secret.json");
  }

  private statePath(): string {
    return path.join(this.boxRoot, "config/connectors/raindrop-state.json");
  }

  private bookmarksDir(): string {
    return path.join(this.boxRoot, "box/bookmarks");
  }

  private async loadConfig(): Promise<RaindropConfig | null> {
    try {
      const content = await fs.readFile(this.configPath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async loadState(): Promise<RaindropState> {
    try {
      const content = await fs.readFile(this.statePath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return { collections: {}, bookmarks: {} };
    }
  }

  private async saveState(state: RaindropState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath()), { recursive: true });
    await fs.writeFile(this.statePath(), JSON.stringify(state, null, 2) + "\n");
  }

  async sync(): Promise<SyncResult> {
    const config = await this.loadConfig();
    if (!config) {
      return { success: true, created: [], updated: [] };
    }

    const state = await this.loadState();
    const pushed: string[] = [];
    const created: string[] = [];
    const updated: string[] = [];
    const errors: string[] = [];

    try {
      // Refresh collection cache
      const svc = this.getRaindrop(config.token);
      const collections = await svc.listCollections();
      state.collections = { Unsorted: -1 };
      for (const c of collections) {
        state.collections[c.title] = c._id;
      }

      // ── Push phase ──
      const pushResult = await this.pushLocalChanges(svc, state);
      pushed.push(...pushResult.pushed);
      errors.push(...pushResult.errors);

      // Commit push changes (cards that got raindrop-id, state changes)
      if (pushResult.modifiedCards.length > 0) {
        const toStage = [
          ...pushResult.modifiedCards.map((p) => path.relative(this.boxRoot, p)),
          path.relative(this.boxRoot, this.statePath()),
        ];
        await this.saveState(state);
        await stageFiles(this.boxRoot, toStage);
        await commit(this.boxRoot, {
          message: buildRaindropPushMessage(pushResult.pushNotes),
          trailers: { "Pushed-By": "raindrop-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
        });
      }

      // ── Pull phase ──
      const pullResult = await this.pullRemoteChanges(svc, state);
      created.push(...pullResult.created);
      updated.push(...pullResult.updated);
      errors.push(...pullResult.errors);

      // Save state and commit pull changes
      await saveTransientState({ boxRoot: this.boxRoot, connectorName: "raindrop", data: { lastSyncTime: new Date().toISOString() } });
      await this.saveState(state);

      if (pullResult.created.length > 0 || pullResult.updated.length > 0 || pullResult.removed.length > 0) {
        const toStage = [
          ...pullResult.created,
          ...pullResult.updated,
          path.relative(this.boxRoot, this.statePath()),
        ];
        // Stage removed files too (git needs to know they're gone)
        for (const removed of pullResult.removed) {
          toStage.push(removed);
        }
        await stageFiles(this.boxRoot, toStage);
        await commit(this.boxRoot, {
          message: buildRaindropPullMessage(pullResult.pullNotes),
          trailers: { "Pulled-By": "raindrop-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
        });
      } else {
        // Still save state even if no card changes
        await this.saveState(state);
      }
    } catch (err) {
      errors.push(`Raindrop sync failed: ${(err as Error).message}`);
    }

    // Create intake job for newly pulled bookmarks
    const jobs: string[] = [];
    if (created.length > 0) {
      const bookmarkCards = created.filter((p) => p.endsWith(".bookmark.card"));
      if (bookmarkCards.length > 0) {
        const jobPath = await createOrAppendIntakeJob({
          boxRoot: this.boxRoot,
          source: "raindrop-connector",
          items: bookmarkCards,
          priority: "low",
          description: `Triage ${bookmarkCards.length} new bookmark${bookmarkCards.length === 1 ? "" : "s"}`,
        });
        jobs.push(jobPath);
        await stageFiles(this.boxRoot, [jobPath]);
        await commit(this.boxRoot, {
          message: "Create intake job for Raindrop bookmarks",
          trailers: { "Created-By": "raindrop-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
        });
      }
    }

    const result: SyncResult = {
      success: errors.length === 0,
      created,
      updated,
    };
    if (pushed.length > 0) result.pushed = pushed;
    if (jobs.length > 0) result.jobs = jobs;
    if (errors.length > 0) result.error = errors.join("; ");
    return result;
  }

  private async pushLocalChanges(
    svc: RaindropService,
    state: RaindropState
  ): Promise<{
    pushed: string[];
    errors: string[];
    modifiedCards: string[];
    pushNotes: PushNote[];
  }> {
    const pushed: string[] = [];
    const errors: string[] = [];
    const modifiedCards: string[] = [];
    const pushNotes: PushNote[] = [];

    const dir = this.bookmarksDir();
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      // No bookmarks directory yet
      return { pushed, errors, modifiedCards, pushNotes };
    }

    const cardFiles = files.filter((f) => f.endsWith(".bookmark.card"));

    // Track which raindrop IDs we see locally (for detecting deletions from state)
    const localRaindropIds = new Set<string>();

    for (const file of cardFiles) {
      const cardPath = path.join(dir, file);
      const relPath = path.relative(this.boxRoot, cardPath);

      try {
        const content = await fs.readFile(cardPath, "utf-8");
        const root = await parseXml(content, relPath);

        if (root.tagName !== "bookmark") continue;

        const { fields, raindropId } = extractAllFromCard(root);
        const hash = computeContentHash(fields);

        if (!raindropId) {
          // New card — create in Raindrop
          const collId = state.collections[fields.collection] ?? -1;
          const payload: Partial<RaindropBookmark> = {
            link: fields.link,
            title: fields.title,
            collection: { $id: collId },
          };
          if (fields.tags.length > 0) payload.tags = fields.tags;
          if (fields.note) payload.note = fields.note;

          const created = await svc.createBookmark(payload);
          const newId = String(created._id);

          // Rewrite card with raindrop-id
          const templateOpts: Parameters<typeof createBookmarkTemplate>[0] = {
            title: created.title || fields.title,
            link: created.link || fields.link,
            raindropId: newId,
            collection: fields.collection,
            created: created.created,
            updated: created.lastUpdate,
          };
          if (created.excerpt) templateOpts.excerpt = created.excerpt;
          if (fields.note) templateOpts.note = fields.note;
          if (fields.tags.length > 0) templateOpts.tags = fields.tags;
          const newContent = createBookmarkTemplate(templateOpts);

          // Rename file to include raindrop ID
          const newFilename = `${safeFilename(fields.title, "Bookmark")}_${newId}.bookmark.card`;
          const newPath = path.join(dir, newFilename);
          await fs.writeFile(newPath, newContent);
          if (newPath !== cardPath) {
            await fs.unlink(cardPath);
          }

          state.bookmarks[newId] = {
            cardPath: path.relative(this.boxRoot, newPath),
            lastSyncedHash: computeContentHash({
              title: created.title || fields.title,
              link: created.link || fields.link,
              note: fields.note,
              tags: fields.tags,
              collection: fields.collection,
            }),
            raindropUpdated: created.lastUpdate,
            syncedFields: {
              title: created.title || fields.title,
              link: created.link || fields.link,
              note: fields.note,
              tags: fields.tags,
              collection: fields.collection,
            },
            title: fields.title,
          };

          localRaindropIds.add(newId);
          pushed.push(relPath);
          modifiedCards.push(newPath);
          if (newPath !== cardPath) modifiedCards.push(cardPath);
          pushNotes.push({ title: fields.title, collection: fields.collection, isNew: true });
        } else {
          localRaindropIds.add(raindropId);
          const entry = state.bookmarks[raindropId];

          if (entry && hash !== entry.lastSyncedHash) {
            // Changed locally — push to Raindrop
            const diff = computeFieldDiff({
              current: fields,
              synced: entry.syncedFields,
              collectionMap: state.collections,
            });

            if (Object.keys(diff).length > 0) {
              await svc.updateBookmark(Number(raindropId), diff);

              entry.lastSyncedHash = hash;
              entry.syncedFields = { ...fields };
              entry.cardPath = relPath;
              pushed.push(relPath);
              pushNotes.push({ title: fields.title, collection: fields.collection, isNew: false });
            }
          } else if (!entry) {
            // Card has raindrop-id but not in state — add to state
            state.bookmarks[raindropId] = {
              cardPath: relPath,
              lastSyncedHash: hash,
              raindropUpdated: "",
              syncedFields: { ...fields },
            };
          }
        }
      } catch (err) {
        errors.push(`Push ${file}: ${(err as Error).message}`);
      }
    }

    // Cards in state but not on disk → removed locally. Remove from state tracking.
    for (const [id, entry] of Object.entries(state.bookmarks)) {
      if (!localRaindropIds.has(id)) {
        // Check if the file actually doesn't exist (it might have been renamed)
        try {
          await fs.access(path.join(this.boxRoot, entry.cardPath));
        } catch {
          // File gone — remove from state
          delete state.bookmarks[id];
        }
      }
    }

    return { pushed, errors, modifiedCards, pushNotes };
  }

  private async pullRemoteChanges(
    svc: RaindropService,
    state: RaindropState
  ): Promise<{
    created: string[];
    updated: string[];
    removed: string[];
    errors: string[];
    pullNotes: PullNote[];
  }> {
    const created: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    const errors: string[] = [];
    const pullNotes: PullNote[] = [];

    const dir = this.bookmarksDir();
    await fs.mkdir(dir, { recursive: true });

    // Build reverse map: collection ID → name
    const collIdToName: Record<number, string> = {};
    for (const [name, id] of Object.entries(state.collections)) {
      collIdToName[id] = name;
    }

    // Paginate through all bookmarks
    const remoteBookmarks: RaindropBookmark[] = [];
    let page = 0;
    while (true) {
      const items = await svc.listBookmarks(0, { page, perpage: 50 });
      if (items.length === 0) break;
      remoteBookmarks.push(...items);
      if (items.length < 50) break;
      page++;
    }
    const remoteIds = new Set<string>();

    for (const rb of remoteBookmarks) {
      const id = String(rb._id);
      remoteIds.add(id);
      const collName = collIdToName[rb.collection.$id] || "Unsorted";

      const fields: BookmarkFields = {
        title: rb.title,
        link: rb.link,
        note: rb.note || "",
        tags: rb.tags || [],
        collection: collName,
      };
      const hash = computeContentHash(fields);

      const entry = state.bookmarks[id];

      if (!entry) {
        // New remote bookmark — create local card
        const filename = `${safeFilename(rb.title, "Bookmark")}_${id}.bookmark.card`;
        const cardPath = path.join(dir, filename);
        const relPath = path.relative(this.boxRoot, cardPath);

        const content = buildBookmarkCard({ rb, id, collName });

        await fs.writeFile(cardPath, content);
        state.bookmarks[id] = {
          cardPath: relPath,
          lastSyncedHash: hash,
          raindropUpdated: rb.lastUpdate,
          syncedFields: fields,
          title: rb.title,
        };
        created.push(relPath);
        pullNotes.push({ action: "new", title: rb.title, collection: collName });
      } else if (rb.lastUpdate > (entry.raindropUpdated || "")) {
        // Remote changed since last sync — overwrite local card
        const filename = `${safeFilename(rb.title, "Bookmark")}_${id}.bookmark.card`;
        const cardPath = path.join(dir, filename);
        const relPath = path.relative(this.boxRoot, cardPath);

        const content = buildBookmarkCard({ rb, id, collName });

        // Remove old file if the name changed
        if (entry.cardPath !== relPath) {
          try {
            await fs.unlink(path.join(this.boxRoot, entry.cardPath));
            removed.push(entry.cardPath); // stage the deletion
          } catch {
            // Old file already gone
          }
        }

        await fs.writeFile(cardPath, content);
        entry.cardPath = relPath;
        entry.lastSyncedHash = hash;
        entry.raindropUpdated = rb.lastUpdate;
        entry.syncedFields = fields;
        entry.title = rb.title;
        updated.push(relPath);
        pullNotes.push({ action: "updated", title: rb.title, collection: collName });
      }
    }

    // Bookmarks in state but not in remote → deleted remotely
    for (const [id, entry] of Object.entries(state.bookmarks)) {
      if (!remoteIds.has(id)) {
        const title = entry.title || entry.syncedFields.title || "Unknown bookmark";
        try {
          await fs.unlink(path.join(this.boxRoot, entry.cardPath));
          removed.push(entry.cardPath);
        } catch {
          // Already gone
        }
        pullNotes.push({ action: "removed", title });
        delete state.bookmarks[id];
      }
    }

    return { created, updated, removed, errors, pullNotes };
  }

}

/**
 * Create and register the Raindrop connector for a box.
 */
export function createRaindropConnector(boxRoot: string, raindrop?: RaindropService): Connector {
  const connector = new RaindropConnector(boxRoot, raindrop);
  registerConnector(connector);
  return connector;
}
