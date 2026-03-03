/**
 * Zustand store for HistoryPage — experimental comparison.
 *
 * State is a plain object; actions are functions mixed into the store.
 * `getState()` returns data + actions; `setState(blob, true)` replaces all state.
 */

import { create } from "zustand";
import { getHistory, type HistoryCommit } from "../api";

const PAGE_SIZE = 50;

export interface HistoryState {
  commits: HistoryCommit[];
  selectedHash: string | null;
  loading: boolean;
  hasMore: boolean;
}

interface HistoryActions {
  select: (hash: string | null) => void;
  loadPage: (offset: number) => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;
}

const initialState: HistoryState = {
  commits: [],
  selectedHash: null,
  loading: true,
  hasMore: true,
};

export const useHistoryStore = create<HistoryState & HistoryActions>((set, get) => ({
  ...initialState,

  select: (hash) => set({ selectedHash: hash }),

  loadPage: async (offset) => {
    set({ loading: true });
    try {
      const result = await getHistory(PAGE_SIZE, offset);
      if (offset === 0) {
        set({
          commits: result.commits,
          hasMore: result.commits.length === PAGE_SIZE,
          loading: false,
        });
      } else {
        set((state) => ({
          commits: [...state.commits, ...result.commits],
          hasMore: result.commits.length === PAGE_SIZE,
          loading: false,
        }));
      }
    } catch (err) {
      console.error("Failed to load history:", err);
      set({ loading: false });
    }
  },

  loadMore: async () => {
    const { commits, loadPage } = get();
    await loadPage(commits.length);
  },

  reset: () => set(initialState),
}));
