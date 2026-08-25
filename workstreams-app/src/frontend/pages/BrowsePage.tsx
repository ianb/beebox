import { useRef } from "react";
import { Link } from "@tanstack/react-router";

import { CodeBlock, languageForPath } from "../components/CodeBlock.js";
import { CommentLayer } from "../components/CommentLayer.js";

import { Markdown } from "../components/Markdown.js";
import { Button, Pill } from "../components/ui.js";
import { trpc } from "../trpc.js";
import type { BrowsedDocument, DirectoryEntry } from "../types.js";

/**
 * The general browser's document view (`docs/plans/general-browser.md`).
 *
 * THE ADDRESS IS THE FILE: `?file=<repo-relative>` with `?workstream=` as a
 * lens over it, following the issues browser, which holds its selection in a
 * search param and redirects the old path-segment URLs into that shape
 * (`router.tsx` legacyIssueRoute). A worktree is never a path segment — that is
 * the `/<worktree>/dev/` shape this replaces.
 */
function KindPill({ document }: { document: BrowsedDocument }) {
  const tone = document.tracked ? "info" : "neutral";
  return (
    <>
      <Pill tone={tone}>{document.kind}</Pill>
      {document.tracked ? null : <Pill tone="warning">untracked</Pill>}
      {document.workstream === null ? null : <Pill tone="accent">{document.workstream}</Pill>}
    </>
  );
}

/**
 * "Is someone else rewriting what I am reading?" — answered at the file, which
 * is the point of Track 3a. Each name links to that workstream's version of the
 * SAME address, because a workstream is a lens and not a location.
 *
 * `changesUnavailable` is rendered rather than swallowed: an incomplete answer
 * that looks complete would report nobody touching a file that three people are
 * touching.
 */
function ChangedIn({ document }: { document: BrowsedDocument }) {
  const others = document.changedIn.filter((name) => name !== document.workstream);
  if (others.length === 0 && document.changesUnavailable.length === 0) return null;
  return (
    <p className="issue-meta browse-changed-in">
      {others.length === 0 ? null : (
        <>
          <span className="muted">changed in</span>
          {others.map((name) => (
            <Link key={name} to="/browse" search={{ file: document.relPath, workstream: name }}>
              {name}
            </Link>
          ))}
        </>
      )}
      {document.changesUnavailable.length === 0 ? null : (
        <span className="action-error" role="status">
          could not check {document.changesUnavailable.join(", ")}
        </span>
      )}
    </p>
  );
}

function DirectoryView({ entries, workstream }: { entries: DirectoryEntry[]; workstream: string | null }) {
  if (entries.length === 0) return <p className="empty-state">Empty directory.</p>;
  return (
    <ul className="document-list">
      {entries.map((entry) => (
        <li key={entry.relPath}>
          <Link
            to="/browse"
            search={workstream === null ? { file: entry.relPath } : { file: entry.relPath, workstream }}
          >
            {entry.name}{entry.kind === "directory" ? "/" : ""}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * A `page` is an agent-authored HTML artifact. It is linked, never inlined:
 * those pages run scripts, and keeping them off this origin is the whole reason
 * the exhibits listener is a separate credential (general-browser.md, "The
 * boundary this plan must not cross").
 */
function PageView({ document }: { document: BrowsedDocument }) {
  return (
    <section className="empty-state">
      <p>
        This is an HTML page. It is not rendered here — agent-authored pages run
        scripts, and this origin holds the workstreams authority.
      </p>
      <pre><code>{document.text ?? ""}</code></pre>
    </section>
  );
}

function DocumentBody({ document }: { document: BrowsedDocument }) {
  // Content we would not read and content that is absent must not look alike.
  if (document.problem !== null) return <p className="error-state">{document.problem}</p>;
  if (document.kind === "directory") {
    return <DirectoryView entries={document.entries} workstream={document.workstream} />;
  }
  if (document.text === null) return <p className="empty-state">No content.</p>;
  // Prose gets a measure; source does not. A 1500px line of English is unread,
  // and a wrapped line of code is misread.
  if (document.kind === "markdown") return <article className="issue-body browse-prose"><Markdown source={document.text} /></article>;
  if (document.kind === "page") return <PageView document={document} />;
  return <CodeBlock source={document.text} language={languageForPath(document.relPath)} />;
}

export function BrowseView({ document }: { document: BrowsedDocument }) {
  const label = document.relPath === "" ? "/" : document.relPath;
  // The comment layer anchors into THIS element, so a selection is only
  // captured when it is inside the rendered document.
  const contentRef = useRef<HTMLDivElement | null>(null);
  return (
    <main className="simple-page">
      <header>
        <h1 className="browse-title">{label}</h1>
        <p className="issue-meta"><KindPill document={document} /></p>
        <ChangedIn document={document} />
      </header>
      <div ref={contentRef}><DocumentBody document={document} /></div>
      {/* A directory has no text to anchor to, and nothing to say about it. */}
      {document.kind === "directory" ? null : (
        <CommentLayer
          relPath={document.relPath}
          workstream={document.workstream}
          changedIn={document.changedIn}
          contentRef={contentRef}
        />
      )}
    </main>
  );
}

export function BrowsePage({ file, workstream }: { file: string; workstream: string | null }) {
  const document = trpc.documents.read.useQuery({ relPath: file, workstream });
  if (document.isLoading) {
    return (
      <main className="simple-page">
        <section className="loading-skeleton" aria-busy="true"><span /><span /><span /></section>
      </main>
    );
  }
  if (document.isError) {
    return (
      <main className="simple-page">
        <section className="error-state">
          <p>Couldn’t read {file === "" ? "the repository root" : file}: {document.error.message}</p>
          <Button onClick={() => void document.refetch()}>Retry</Button>
        </section>
      </main>
    );
  }
  if (!document.data) return <main className="simple-page"><p className="empty-state">Nothing to show.</p></main>;
  return <BrowseView document={document.data} />;
}
