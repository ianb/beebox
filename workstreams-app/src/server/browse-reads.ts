// The browser's read methods, split out of documents-service.ts.
//
// They belong together and apart: together because all four answer questions
// about ONE address space (a document, its neighbours, and the two directions
// of the workstream lens), and apart because documents-service owns the issue
// transaction and had grown past its line ceiling carrying both.
//
// Every method reads through the SAME 60-second snapshot the issue views use,
// so the file view and the issue views can never disagree about what a
// workstream has touched.

import { readDocument, rootForWorkstream } from "./document-read.js";
import { listBrowsablePaths } from "./file-index.js";
import { collectRecentFiles } from "./recency.js";
import type { BrowsedDocument, PathIndex, RecentFeed, WorkstreamChangedFiles } from "../shared/documents.js";
import type { WorkstreamChanges } from "./workstream-changes.js";
import type { OverlayResult } from "./issue-overlay.js";

/** The slice of the documents snapshot these reads need. */
export interface BrowseSnapshot {
  overlay: OverlayResult;
  changes: WorkstreamChanges;
}

export interface BrowseReads {
  readDocument(request: { relPath: string; workstream: string | null }): Promise<BrowsedDocument>;
  recentFiles(): Promise<RecentFeed>;
  pathIndex(workstream: string | null): Promise<PathIndex>;
  changedFiles(workstream: string): Promise<WorkstreamChangedFiles>;
}

export function createBrowseReads(options: {
  mainRoot: string;
  snapshot: () => Promise<BrowseSnapshot>;
}): BrowseReads {
  const { mainRoot, snapshot } = options;
  const rootsFrom = (state: BrowseSnapshot) => ({
    mainRoot,
    worktreeRoots: state.overlay.worktreeRoots,
  });

  return {
    async readDocument(request): Promise<BrowsedDocument> {
      // The overlay already knows every live worktree root; reusing it keeps
      // one answer to "where is workstream X" rather than a second scan that
      // could disagree with the issue views.
      const state = await snapshot();
      return readDocument(rootsFrom(state), { ...request, changes: state.changes });
    },
    async recentFiles(): Promise<RecentFeed> {
      const state = await snapshot();
      const feed = await collectRecentFiles(rootsFrom(state));
      return {
        now: feed.now,
        files: feed.files,
        distribution: feed.distribution,
        unavailable: [...feed.unavailable].map(([workstream, problem]) => ({ workstream, problem })),
        truncated: feed.truncated,
      };
    },
    async pathIndex(workstream): Promise<PathIndex> {
      const state = await snapshot();
      const root = rootForWorkstream(rootsFrom(state), workstream);
      return { workstream, paths: await listBrowsablePaths(root) };
    },
    async changedFiles(workstream): Promise<WorkstreamChangedFiles> {
      const state = await snapshot();
      const unavailable = state.changes.unavailable.get(workstream);
      if (unavailable !== undefined) return { workstream, paths: [], problem: unavailable };
      const paths = state.changes.byWorkstream.get(workstream);
      // THREE states, not two. A workstream that was scanned and changed
      // nothing, one whose scan failed, and one that is not a live workstream
      // at all are different answers — returning an empty list for the third
      // would report "changed nothing" about something that does not exist.
      if (paths === undefined) {
        return { workstream, paths: [], problem: `${workstream} is not a live workstream` };
      }
      return { workstream, paths, problem: null };
    },
  };
}
