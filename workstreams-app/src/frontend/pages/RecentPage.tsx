import { Link } from "@tanstack/react-router";

import { Button, Pill } from "../components/ui.js";
import { trpc } from "../trpc.js";
import type { RecentFeed, RecentFile } from "../types.js";

/**
 * The browser's front door (`docs/plans/general-browser.md`, Track 3).
 *
 * A feed, not a file tree: "a file is interesting if it has been modified
 * recently, IN ANY WORKSTREAM." The tree is still reachable by browsing into a
 * directory; it just is not what you land on.
 */
function ago(at: number, now: number): string {
  const seconds = Math.max(0, now - at);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

function RecentRow({ file, now }: { file: RecentFile; now: number }) {
  const search = file.workstream === null
    ? { file: file.relPath }
    : { file: file.relPath, workstream: file.workstream };
  return (
    <li>
      <Link to="/browse" search={search}>{file.relPath}</Link>
      <span className="muted">{ago(file.at, now)}</span>
      {file.workstream === null ? null : <Pill tone="accent">{file.workstream}</Pill>}
      {file.inProgress ? <Pill tone="warning">in progress</Pill> : null}
    </li>
  );
}

/** How much recent work came from where — the third view over one dataset. */
function Distribution({ feed }: { feed: RecentFeed }) {
  if (feed.distribution.length === 0) return null;
  const total = feed.distribution.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <p className="issue-meta recent-distribution">
      <span className="muted">{String(total)} recent changes from</span>
      {feed.distribution.map((entry) => (
        <Link
          key={entry.workstream ?? "main"}
          to="/"
          search={entry.workstream === null ? {} : { workstream: entry.workstream }}
        >
          {entry.workstream ?? "main"} ({String(entry.count)})
        </Link>
      ))}
    </p>
  );
}

export function RecentView({ feed, workstream }: { feed: RecentFeed; workstream: string | null }) {
  // The feed carries the moment it was computed, so relative times are honest
  // about the data's age and the render stays pure — no clock read here.
  const now = feed.now;
  // Filtering narrows the same feed. It is not a per-workstream browser — the
  // address space and every link are unchanged.
  const files = workstream === null
    ? feed.files
    : feed.files.filter((file) => file.workstream === workstream);
  return (
    <main className="simple-page">
      <h1>recent {workstream === null ? null : <small>{workstream}</small>}</h1>
      <Distribution feed={feed} />
      {feed.unavailable.length === 0 ? null : (
        <p className="action-error" role="status">
          Could not scan {feed.unavailable.map((entry) => entry.workstream).join(", ")} — this list is incomplete.
        </p>
      )}
      {workstream === null ? null : (
        <p><Link to="/" search={{}}>← everything</Link></p>
      )}
      {files.length === 0
        ? <p className="empty-state">Nothing changed recently{workstream === null ? "" : ` in ${workstream}`}.</p>
        : <ul className="document-list recent-list">{files.map((file) => (
            <RecentRow key={`${file.workstream ?? "main"}:${file.relPath}`} file={file} now={now} />
          ))}</ul>}
      {feed.truncated ? <p className="muted">Showing the most recent changes only.</p> : null}
    </main>
  );
}

export function RecentPage({ workstream }: { workstream: string | null }) {
  const recent = trpc.documents.recent.useQuery();
  if (recent.isLoading) {
    return (
      <main className="simple-page">
        <section className="loading-skeleton" aria-busy="true"><span /><span /><span /></section>
      </main>
    );
  }
  if (recent.isError) {
    return (
      <main className="simple-page">
        <section className="error-state">
          <p>Couldn’t load recent changes: {recent.error.message}</p>
          <Button onClick={() => void recent.refetch()}>Retry</Button>
        </section>
      </main>
    );
  }
  if (!recent.data) return <main className="simple-page"><p className="empty-state">Nothing to show.</p></main>;
  return <RecentView feed={recent.data} workstream={workstream} />;
}
