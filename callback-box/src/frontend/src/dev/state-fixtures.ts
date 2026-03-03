/**
 * State fixtures for testing rendering with different state blobs.
 *
 * Each fixture is a plain JSON-serializable object representing
 * the state of the HistoryPage in different scenarios.
 */

import type { HistoryCommit } from "../api";

export interface HistoryStateFixture {
  commits: HistoryCommit[];
  selectedHash: string | null;
  loading: boolean;
  hasMore: boolean;
}

export const fixtures: Record<string, HistoryStateFixture> = {
  empty: {
    commits: [],
    selectedHash: null,
    loading: false,
    hasMore: false,
  },

  loading: {
    commits: [],
    selectedHash: null,
    loading: true,
    hasMore: true,
  },

  fewCommits: {
    commits: [
      {
        hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        date: "2026-03-01T14:30:00Z",
        subject: "Fix news brief date parsing for timezone edge cases",
        body: "The brief date was being parsed in local time instead of UTC,\ncausing briefs to appear on the wrong day near midnight.\n\nAlso fixes a related issue where archived briefs lost their\noriginal date during the move operation.",
        trailers: { Session: "abc-123", "Sent-By": "wakeup" },
      },
      {
        hash: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
        date: "2026-03-01T12:15:00Z",
        subject: "Add calendar sync connector",
        trailers: { Session: "abc-123" },
      },
      {
        hash: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        date: "2026-02-28T23:45:00Z",
        subject: "Refactor scheduled script execution to support chaining",
        body: "Scheduled scripts can now declare create-after-success to\nchain subsequent scripts after successful execution.",
        trailers: { Session: "def-456", "Sent-By": "reactor" },
      },
    ],
    selectedHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    loading: false,
    hasMore: false,
  },

  manyCommits: {
    commits: Array.from({ length: 50 }, (_, i) => ({
      hash: `${String(i).padStart(4, "0")}${"a".repeat(36)}`,
      date: new Date(2026, 2, 1, 12, 0, 0, 0).toISOString(),
      subject: `Commit number ${i + 1}: ${["Fix bug", "Add feature", "Refactor code", "Update docs", "Run reactor"][i % 5]}`,
      trailers: i % 3 === 0 ? { Session: `session-${Math.floor(i / 3)}` } : undefined,
    })),
    selectedHash: `${"0000"}${"a".repeat(36)}`,
    loading: false,
    hasMore: true,
  },

  noSelection: {
    commits: [
      {
        hash: "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
        date: "2026-03-02T09:00:00Z",
        subject: "Morning wakeup cycle",
        trailers: { "Sent-By": "wakeup" },
      },
      {
        hash: "e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
        date: "2026-03-02T08:00:00Z",
        subject: "Process news intake job",
        trailers: { "Sent-By": "reactor" },
      },
    ],
    selectedHash: null,
    loading: false,
    hasMore: true,
  },
};

/** XState fixtures also include the machine state value. */
export interface XStateHistoryFixture {
  value: string;
  context: HistoryStateFixture & { error: string | null };
}

export const xstateFixtures: Record<string, XStateHistoryFixture> = {
  loading: {
    value: "loading",
    context: { ...fixtures.loading, error: null },
  },
  idle: {
    value: "idle",
    context: { ...fixtures.fewCommits, error: null },
  },
  error: {
    value: "error",
    context: {
      commits: [],
      selectedHash: null,
      loading: false,
      hasMore: true,
      error: "Network timeout: failed to reach server after 30s",
    },
  },
};
