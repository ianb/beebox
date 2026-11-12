import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { searchPaths } from "../lib/path-search.js";
import { trpc } from "../trpc.js";
import { issueRelPathFromRepoPath } from "../../shared/documents.js";
import { DocumentLifecycleBadges } from "./DocumentLifecycleBadges.js";
import { useModalDialog } from "./useModalDialog.js";

/**
 * Cmd-P over every browsable path — ported from the retired doc browser's
 * quick-open (formerly `renderDocQuickOpen` in router-docs.ts), which is one
 * of the affordances the consolidation has to keep. Replacing five reading
 * surfaces with one is only an improvement if finding things gets easier.
 *
 * The corpus is fetched once per workstream lens and filtered in the browser:
 * a few thousand paths is nothing to filter locally, and a round trip per
 * keystroke would make it feel worse than the surface it replaces.
 */
const RESULT_LIMIT = 20;

export function QuickOpen({ workstream }: { workstream: string | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  // Only fetched once opened, so the palette costs nothing until it is wanted.
  const index = trpc.documents.paths.useQuery({ workstream }, { enabled: open });

  const dialogRef = useModalDialog(open);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "p") {
        event.preventDefault();
        // Close an open dialog through close() so focus returns where it was
        // (its close event then unmounts it); unmounting an open dialog skips that.
        const dialog = dialogRef.current;
        if (dialog?.open === true) dialog.close();
        else setOpen((current) => !current);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [dialogRef]);

  if (!open) return null;

  const matches = searchPaths(index.data?.paths ?? [], { text: query, limit: RESULT_LIMIT });
  // An issue opens in the issue viewer, the same decision the recency feed
  // makes (`RecentPage.tsx` recentRowTarget) — the palette is a way to reach a
  // document, not a way to reach the markdown reader specifically.
  function choose(relPath: string): void {
    dialogRef.current?.close();
    setOpen(false);
    setQuery("");
    const issue = issueRelPathFromRepoPath(relPath);
    if (issue !== null) {
      void navigate({ to: "/issues", search: { issue } });
      return;
    }
    void navigate({
      to: "/browse",
      search: workstream === null ? { file: relPath } : { file: relPath, workstream },
    });
  }

  return (
    // A native modal dialog: Escape, click-outside (closedby), focus
    // trapping and an inert page behind it come from the platform.
    <dialog
      ref={dialogRef}
      className="quick-open"
      aria-label="Open a file"
      onClose={() => { setOpen(false); }}
    >
    <input
      className="quick-open-input"
      type="text"
      autoFocus
      placeholder={workstream === null ? "Open a file…" : `Open a file in ${workstream}…`}
      value={query}
      onChange={(event) => { setQuery(event.target.value); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing && matches[0]) choose(matches[0].relPath);
      }}
    />
    {/* An empty corpus and an empty search are different states. */}
    {index.isLoading ? <p className="muted">Loading paths…</p> : null}
    {index.isError ? <p className="action-error">Couldn’t load paths: {index.error.message}</p> : null}
    {!index.isLoading && !index.isError && matches.length === 0 && query !== ""
      ? <p className="empty-state">No path matches “{query}”.</p>
      : null}
    <ul role="list" className="quick-open-results">
      {matches.map((match, position) => (
        <li key={match.relPath}>
          <button
            type="button"
            className={position === 0 ? "quick-open-hit first" : "quick-open-hit"}
            onClick={() => { choose(match.relPath); }}
          >
            {match.relPath}
            <span className="quick-open-lifecycle"><DocumentLifecycleBadges lifecycle={match.lifecycle} /></span>
          </button>
        </li>
      ))}
    </ul>
    </dialog>
  );
}
