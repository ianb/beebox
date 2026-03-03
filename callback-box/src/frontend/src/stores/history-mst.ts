/**
 * MobX-State-Tree store for HistoryPage — experimental comparison.
 *
 * State is a typed model. `getSnapshot()` returns plain JSON.
 * `applySnapshot()` replaces state from a JSON blob.
 * `Model.create(json)` creates a new instance from a snapshot.
 */

import { types, type Instance, flow } from "mobx-state-tree";
import { getHistory } from "../api";

const PAGE_SIZE = 50;

const CommitModel = types.model("Commit", {
  hash: types.string,
  date: types.string,
  subject: types.string,
  body: types.maybe(types.string),
  trailers: types.maybe(types.frozen<Record<string, string | string[]>>()),
});

export const HistoryStoreModel = types
  .model("HistoryStore", {
    commits: types.array(CommitModel),
    selectedHash: types.maybeNull(types.string),
    loading: types.optional(types.boolean, true),
    hasMore: types.optional(types.boolean, true),
  })
  .views((self) => ({
    get selectedCommit(): Instance<typeof CommitModel> | null {
      if (!self.selectedHash) return null;
      return self.commits.find((c) => c.hash === self.selectedHash) ?? null;
    },
  }))
  .actions((self) => ({
    select(hash: string | null) {
      self.selectedHash = hash;
    },
    setLoading(v: boolean) {
      self.loading = v;
    },
  }))
  .actions((self) => ({
    loadPage: flow(function* loadPage(offset: number) {
      self.setLoading(true);
      try {
        const result: Awaited<ReturnType<typeof getHistory>> = yield getHistory(PAGE_SIZE, offset);
        if (offset === 0) {
          self.commits.replace(result.commits as Instance<typeof CommitModel>[]);
        } else {
          for (const c of result.commits) {
            self.commits.push(c as Instance<typeof CommitModel>);
          }
        }
        self.hasMore = result.commits.length === PAGE_SIZE;
      } catch (err) {
        console.error("Failed to load history:", err);
      } finally {
        self.setLoading(false);
      }
    }),
  }))
  .actions((self) => ({
    loadMore: flow(function* loadMore() {
      yield self.loadPage(self.commits.length);
    }),
  }));

export type HistoryStore = Instance<typeof HistoryStoreModel>;

export const historyStore = HistoryStoreModel.create({
  commits: [],
  selectedHash: null,
  loading: true,
  hasMore: true,
});
