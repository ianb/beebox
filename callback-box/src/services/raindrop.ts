/**
 * Raindrop service — typed interface for the Raindrop.io bookmark API.
 *
 * Real implementation calls the REST API with Bearer token auth.
 * Fake maintains in-memory collections and bookmarks.
 */

import ky from "ky";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RaindropCollection {
  _id: number;
  title: string;
  count: number;
}

export interface RaindropBookmark {
  _id: number;
  title: string;
  link: string;
  excerpt: string;
  note: string;
  tags: string[];
  collection: { $id: number };
  created: string;
  lastUpdate: string;
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface RaindropService {
  listCollections(): Promise<RaindropCollection[]>;
  listBookmarks(collectionId: number, opts?: { page?: number; perpage?: number }): Promise<RaindropBookmark[]>;
  createBookmark(bookmark: Partial<RaindropBookmark>): Promise<RaindropBookmark>;
  updateBookmark(id: number, fields: Partial<RaindropBookmark>): Promise<RaindropBookmark>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createRaindropService(token: string): RaindropService {
  const api = ky.create({
    prefixUrl: "https://api.raindrop.io/rest/v1",
    headers: { Authorization: `Bearer ${token}` },
    retry: 2,
  });

  return {
    async listCollections() {
      const data = await api.get("collections").json<{ items: RaindropCollection[] }>();
      return data.items;
    },

    async listBookmarks(collectionId, opts) {
      const page = opts?.page ?? 0;
      const perpage = opts?.perpage ?? 50;
      const data = await api
        .get(`raindrops/${collectionId}`, { searchParams: { page, perpage } })
        .json<{ items: RaindropBookmark[] }>();
      return data.items;
    },

    async createBookmark(bookmark) {
      const data = await api.post("raindrop", { json: bookmark }).json<{ item: RaindropBookmark }>();
      return data.item;
    },

    async updateBookmark(id, fields) {
      const data = await api.put(`raindrop/${id}`, { json: fields }).json<{ item: RaindropBookmark }>();
      return data.item;
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeRaindropOptions {
  collections?: RaindropCollection[];
  bookmarks?: RaindropBookmark[];
}

export interface FakeRaindropService extends RaindropService {
  collections: RaindropCollection[];
  bookmarks: RaindropBookmark[];
}

export function createFakeRaindrop(
  opts?: FakeRaindropOptions,
): FakeRaindropService {
  let nextId = 1000;

  const fake: FakeRaindropService = {
    collections: [...(opts?.collections ?? [])],
    bookmarks: [...(opts?.bookmarks ?? [])],

    async listCollections() {
      return fake.collections;
    },

    async listBookmarks(_collectionId, _opts) {
      return fake.bookmarks;
    },

    async createBookmark(bookmark) {
      const full: RaindropBookmark = {
        _id: nextId++,
        title: "",
        link: "",
        excerpt: "",
        note: "",
        tags: [],
        collection: { $id: 0 },
        created: new Date().toISOString(),
        lastUpdate: new Date().toISOString(),
        ...bookmark,
      } as RaindropBookmark;
      fake.bookmarks.push(full);
      return full;
    },

    async updateBookmark(id, fields) {
      const idx = fake.bookmarks.findIndex((b) => b._id === id);
      if (idx === -1) throw new Error(`Bookmark ${id} not found`);
      fake.bookmarks[idx] = { ...fake.bookmarks[idx]!, ...fields };
      return fake.bookmarks[idx]!;
    },
  };

  return fake;
}
