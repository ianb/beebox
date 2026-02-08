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
  type PullResult,
  type ExecuteResult,
} from "./index.js";
import { createBookmarkTemplate } from "../schemas/bookmark.js";
import { stageFiles, commit } from "../cli/lib/git.js";

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
}

interface RaindropState {
  lastSyncTime?: string;
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

interface RaindropCollection {
  _id: number;
  title: string;
}

// ─── API Client ─────────────────────────────────────────────────────────────

const API_BASE = "https://api.raindrop.io/rest/v1";

async function raindropFetch(
  token: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = `${API_BASE}${endpoint}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Raindrop API ${resp.status}: ${resp.statusText} - ${body}`);
  }
  return resp.json();
}

async function fetchCollections(token: string): Promise<RaindropCollection[]> {
  const data = (await raindropFetch(token, "/collections")) as {
    items: RaindropCollection[];
  };
  return data.items || [];
}

async function fetchAllBookmarks(token: string): Promise<RaindropBookmark[]> {
  const all: RaindropBookmark[] = [];
  let page = 0;
  while (true) {
    const data = (await raindropFetch(
      token,
      `/raindrops/0?page=${page}&perpage=50`
    )) as { items: RaindropBookmark[] };
    if (!data.items || data.items.length === 0) break;
    all.push(...data.items);
    if (data.items.length < 50) break;
    page++;
  }
  return all;
}

async function createRaindrop(
  token: string,
  payload: {
    link: string;
    title?: string;
    tags?: string[];
    note?: string;
    collection?: { $id: number };
  }
): Promise<RaindropBookmark> {
  const data = (await raindropFetch(token, "/raindrop", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as { item: RaindropBookmark };
  return data.item;
}

async function updateRaindrop(
  token: string,
  id: number,
  payload: Partial<{
    title: string;
    link: string;
    tags: string[];
    note: string;
    collection: { $id: number };
  }>
): Promise<RaindropBookmark> {
  const data = (await raindropFetch(token, `/raindrop/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  })) as { item: RaindropBookmark };
  return data.item;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function computeContentHash(fields: BookmarkFields): string {
  const normalized = JSON.stringify({
    title: fields.title.trim(),
    link: fields.link.trim(),
    note: fields.note.trim(),
    tags: [...fields.tags].sort(),
    collection: fields.collection.trim(),
  });
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function computeFieldDiff(
  current: BookmarkFields,
  synced: BookmarkFields,
  collectionMap: Record<string, number>
): Partial<{
  title: string;
  link: string;
  tags: string[];
  note: string;
  collection: { $id: number };
}> {
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
  if (JSON.stringify([...current.tags].sort()) !== JSON.stringify([...synced.tags].sort())) {
    diff.tags = current.tags;
  }
  if (current.collection !== synced.collection) {
    const collId = collectionMap[current.collection] ?? -1;
    diff.collection = { $id: collId };
  }
  return diff;
}

function safeFilename(text: string): string {
  return (
    text
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50) || "Bookmark"
  );
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

/** Build a bookmark card from a Raindrop API response. */
function buildBookmarkCard(rb: RaindropBookmark, id: string, collName: string): string {
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

// ─── Connector ──────────────────────────────────────────────────────────────

class RaindropConnector implements Connector {
  name = "raindrop";
  handles: string[] = [];
  produces = ["bookmark"];

  private boxRoot: string;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
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

  async pull(): Promise<PullResult> {
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
      const collections = await fetchCollections(config.token);
      state.collections = { Unsorted: -1 };
      for (const c of collections) {
        state.collections[c.title] = c._id;
      }

      // ── Push phase ──
      const pushResult = await this.pushLocalChanges(config.token, state);
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
          message: `Push ${pushed.length} bookmark(s) to Raindrop`,
          trailers: { "Pushed-By": "raindrop-connector" },
        });
      }

      // ── Pull phase ──
      const pullResult = await this.pullRemoteChanges(config.token, state);
      created.push(...pullResult.created);
      updated.push(...pullResult.updated);
      errors.push(...pullResult.errors);

      // Save state and commit pull changes
      state.lastSyncTime = new Date().toISOString();
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
        const parts: string[] = [];
        if (pullResult.created.length) parts.push(`${pullResult.created.length} new`);
        if (pullResult.updated.length) parts.push(`${pullResult.updated.length} updated`);
        if (pullResult.removed.length) parts.push(`${pullResult.removed.length} removed`);
        await commit(this.boxRoot, {
          message: `Pull ${parts.join(", ")} bookmark(s) from Raindrop`,
          trailers: { "Pulled-By": "raindrop-connector" },
        });
      } else {
        // Still save state even if no card changes
        await this.saveState(state);
      }
    } catch (err) {
      errors.push(`Raindrop sync failed: ${(err as Error).message}`);
    }

    const result: PullResult = {
      success: errors.length === 0,
      created,
      updated,
    };
    if (pushed.length > 0) result.pushed = pushed;
    if (errors.length > 0) result.error = errors.join("; ");
    return result;
  }

  private async pushLocalChanges(
    token: string,
    state: RaindropState
  ): Promise<{
    pushed: string[];
    errors: string[];
    modifiedCards: string[];
  }> {
    const pushed: string[] = [];
    const errors: string[] = [];
    const modifiedCards: string[] = [];

    const dir = this.bookmarksDir();
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      // No bookmarks directory yet
      return { pushed, errors, modifiedCards };
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
          const payload: Parameters<typeof createRaindrop>[1] = {
            link: fields.link,
            title: fields.title,
            collection: { $id: collId },
          };
          if (fields.tags.length > 0) payload.tags = fields.tags;
          if (fields.note) payload.note = fields.note;

          const created = await createRaindrop(token, payload);
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
          const newFilename = `${safeFilename(fields.title)}_${newId}.bookmark.card`;
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
          };

          localRaindropIds.add(newId);
          pushed.push(relPath);
          modifiedCards.push(newPath);
          if (newPath !== cardPath) modifiedCards.push(cardPath);
        } else {
          localRaindropIds.add(raindropId);
          const entry = state.bookmarks[raindropId];

          if (entry && hash !== entry.lastSyncedHash) {
            // Changed locally — push to Raindrop
            const diff = computeFieldDiff(fields, entry.syncedFields, state.collections);

            if (Object.keys(diff).length > 0) {
              await updateRaindrop(token, Number(raindropId), diff);

              entry.lastSyncedHash = hash;
              entry.syncedFields = { ...fields };
              entry.cardPath = relPath;
              pushed.push(relPath);
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

    return { pushed, errors, modifiedCards };
  }

  private async pullRemoteChanges(
    token: string,
    state: RaindropState
  ): Promise<{
    created: string[];
    updated: string[];
    removed: string[];
    errors: string[];
  }> {
    const created: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    const errors: string[] = [];

    const dir = this.bookmarksDir();
    await fs.mkdir(dir, { recursive: true });

    // Build reverse map: collection ID → name
    const collIdToName: Record<number, string> = {};
    for (const [name, id] of Object.entries(state.collections)) {
      collIdToName[id] = name;
    }

    const remoteBookmarks = await fetchAllBookmarks(token);
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
        const filename = `${safeFilename(rb.title)}_${id}.bookmark.card`;
        const cardPath = path.join(dir, filename);
        const relPath = path.relative(this.boxRoot, cardPath);

        const content = buildBookmarkCard(rb, id, collName);

        await fs.writeFile(cardPath, content);
        state.bookmarks[id] = {
          cardPath: relPath,
          lastSyncedHash: hash,
          raindropUpdated: rb.lastUpdate,
          syncedFields: fields,
        };
        created.push(relPath);
      } else if (rb.lastUpdate > (entry.raindropUpdated || "")) {
        // Remote changed since last sync — overwrite local card
        const filename = `${safeFilename(rb.title)}_${id}.bookmark.card`;
        const cardPath = path.join(dir, filename);
        const relPath = path.relative(this.boxRoot, cardPath);

        const content = buildBookmarkCard(rb, id, collName);

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
        updated.push(relPath);
      }
    }

    // Bookmarks in state but not in remote → deleted remotely
    for (const [id, entry] of Object.entries(state.bookmarks)) {
      if (!remoteIds.has(id)) {
        try {
          await fs.unlink(path.join(this.boxRoot, entry.cardPath));
          removed.push(entry.cardPath);
        } catch {
          // Already gone
        }
        delete state.bookmarks[id];
      }
    }

    return { created, updated, removed, errors };
  }

  async execute(_cardPath: string, _dryRun: boolean): Promise<ExecuteResult> {
    return {
      success: false,
      error: "Raindrop connector does not support command execution",
    };
  }
}

/**
 * Create and register the Raindrop connector for a box.
 */
export function createRaindropConnector(boxRoot: string): Connector {
  const connector = new RaindropConnector(boxRoot);
  registerConnector(connector);
  return connector;
}
