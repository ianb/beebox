/**
 * XState machine for HistoryPage — experimental comparison.
 *
 * State is modeled as explicit states (loading, idle, error) with defined transitions.
 * Context holds the data. Persisted snapshots include both state value and context.
 */

import { setup, assign, fromPromise } from "xstate";
import { getHistory, type HistoryCommit } from "../api";

const PAGE_SIZE = 50;

export interface HistoryContext {
  commits: HistoryCommit[];
  selectedHash: string | null;
  hasMore: boolean;
  error: string | null;
}

export const historyMachine = setup({
  types: {
    context: {} as HistoryContext,
    events: {} as
      | { type: "SELECT"; hash: string | null }
      | { type: "LOAD_MORE" }
      | { type: "RETRY" },
  },
  actors: {
    fetchPage: fromPromise(async ({ input }: { input: { offset: number } }) => {
      return await getHistory(PAGE_SIZE, input.offset);
    }),
  },
}).createMachine({
  id: "history",
  initial: "loading",
  context: {
    commits: [],
    selectedHash: null,
    hasMore: true,
    error: null,
  },
  on: {
    // SELECT works in any state
    SELECT: {
      actions: assign({ selectedHash: ({ event }) => event.hash }),
    },
  },
  states: {
    loading: {
      invoke: {
        src: "fetchPage",
        input: ({ context }) => ({ offset: context.commits.length }),
        onDone: {
          target: "idle",
          actions: assign({
            commits: ({ context, event }) =>
              context.commits.length === 0
                ? event.output.commits
                : [...context.commits, ...event.output.commits],
            hasMore: ({ event }) => event.output.commits.length === PAGE_SIZE,
            error: () => null,
          }),
        },
        onError: {
          target: "error",
          actions: assign({ error: ({ event }) => String(event.error) }),
        },
      },
    },
    idle: {
      on: {
        LOAD_MORE: {
          target: "loading",
          guard: ({ context }) => context.hasMore,
        },
      },
    },
    error: {
      on: {
        RETRY: "loading",
      },
    },
  },
});
