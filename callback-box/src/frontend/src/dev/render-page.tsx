/**
 * CGI-style renderer: takes a route + state blob, outputs HTML.
 *
 * Usage:
 *   npx tsx src/dev/render-page.tsx <framework> [fixture-name]
 *   echo '{"commits":[...]}' | npx tsx src/dev/render-page.tsx zustand -
 *
 * Frameworks: original, zustand, mst, xstate
 * Fixtures: empty, loading, fewCommits, manyCommits, noSelection
 *           (xstate also: error)
 *
 * Output: HTML string to stdout.
 *
 * Note: Since React SSR doesn't run useEffect or support store hooks the
 * same way as the client, this renderer uses a presentational wrapper that
 * receives state as props. This tests the same component tree (Sidebar,
 * CommitTimeline, CommitDetail) but bypasses the store plumbing — which is
 * actually the point: "give it a state blob, get UI."
 */

import { renderToString } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Child components — the actual rendering layer
import { Sidebar } from "../components/Sidebar";
import { CommitTimeline } from "../components/CommitTimeline";
import { CommitDetail } from "../components/CommitDetail";

import { fixtures, xstateFixtures, type HistoryStateFixture } from "./state-fixtures";

// ---------------------------------------------------------------------------

const FRAMEWORKS = ["original", "zustand", "mst", "xstate"];

/**
 * Presentational HistoryPage — pure function of state.
 * This is what all four frameworks converge to: state in, UI out.
 */
function HistoryPagePresenter({ state, label }: { state: HistoryStateFixture; label: string }) {
  const selectedCommit = state.selectedHash
    ? state.commits.find((c) => c.hash === state.selectedHash) ?? null
    : null;
  const hasDetail = Boolean(selectedCommit);

  return (
    <div className="h-full flex">
      <Sidebar title={`Commits (${label})`} subtitle={`${state.commits.length} loaded`} detailSelected={hasDetail}>
        <CommitTimeline
          commits={state.commits}
          selectedHash={state.selectedHash}
          onSelect={() => {}}
          onLoadMore={() => {}}
          hasMore={state.hasMore}
          loading={state.loading}
        />
      </Sidebar>

      <div className={`flex-1 bg-white overflow-hidden ${hasDetail ? "" : "hidden sm:block"}`}>
        {selectedCommit ? (
          <div className="h-full flex flex-col">
            <button className="sm:hidden flex items-center gap-1 px-3 py-2 text-sm text-plum hover:text-plum-dark border-b">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to commits
            </button>
            <div className="flex-1 overflow-hidden">
              <CommitDetail commit={selectedCommit} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-warm-500">
            {state.loading ? "Loading..." : "Select a commit to view details"}
          </div>
        )}
      </div>
    </div>
  );
}

/** XState error state rendering. */
function ErrorPresenter({ error }: { error: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <p className="text-red-600">Failed to load history: {error}</p>
      <button className="px-4 py-2 bg-plum text-white rounded hover:bg-plum-dark">
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface RenderOpts {
  framework: string;
  state: HistoryStateFixture;
  error?: string | null;
}

function renderPage({ framework, state, error }: RenderOpts): string {
  if (!FRAMEWORKS.includes(framework)) {
    throw new Error(`Unknown framework: ${framework}. Options: ${FRAMEWORKS.join(", ")}`);
  }

  // XState error state gets special rendering
  if (framework === "xstate" && error) {
    return renderToString(
      <div className="h-full flex">
        <Sidebar title="Commits (XState)" subtitle="0 loaded" detailSelected={false}>
          <CommitTimeline
            commits={[]}
            selectedHash={null}
            onSelect={() => {}}
            onLoadMore={() => {}}
            hasMore={false}
            loading={false}
          />
        </Sidebar>
        <div className="flex-1 bg-white overflow-hidden">
          <ErrorPresenter error={error} />
        </div>
      </div>
    );
  }

  const hashParam = state.selectedHash?.substring(0, 8);
  const path = hashParam ? `/page/${hashParam}` : "/page";

  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/page/:hash?" element={<HistoryPagePresenter state={state} label={framework} />} />
      </Routes>
    </MemoryRouter>
  );
}

function wrapInDocument(html: string, title: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 0; }
    .h-full { height: 100vh; }
    .flex { display: flex; }
    .flex-1 { flex: 1; }
    .flex-col { flex-direction: column; }
    .flex-shrink-0 { flex-shrink: 0; }
    .items-center { align-items: center; }
    .justify-center { justify-content: center; }
    .justify-between { justify-content: space-between; }
    .gap-1 { gap: 0.25rem; }
    .gap-3 { gap: 0.75rem; }
    .min-w-0 { min-width: 0; }
    .min-h-0 { min-height: 0; }
    .overflow-hidden { overflow: hidden; }
    .overflow-auto { overflow: auto; }
    .bg-white { background: white; }
    .bg-warm-50 { background: #fafaf9; }
    .border-b { border-bottom: 1px solid #e5e7eb; }
    .border-l-2 { border-left: 2px solid #e5e7eb; }
    .divide-y > * + * { border-top: 1px solid #e5e7eb; }
    .text-sm { font-size: 0.875rem; }
    .text-xs { font-size: 0.75rem; }
    .text-base { font-size: 1rem; }
    .font-medium { font-weight: 500; }
    .font-mono { font-family: ui-monospace, monospace; }
    .font-bold { font-weight: 700; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .p-3 { padding: 0.75rem; }
    .p-4 { padding: 1rem; }
    .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
    .px-4 { padding-left: 1rem; padding-right: 1rem; }
    .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
    .rounded { border-radius: 0.25rem; }
    .hidden { display: none; }
    .block { display: block; }
    .w-4 { width: 1rem; }
    .h-4 { height: 1rem; }
    .w-2 { width: 0.5rem; }
    .h-2 { height: 0.5rem; }
    .text-center { text-align: center; }
    .text-warm-500 { color: #78716c; }
    .text-warm-600 { color: #57534e; }
    .text-warm-700 { color: #44403c; }
    .text-plum { color: #7c3aed; }
    .bg-plum { background: #7c3aed; }
    .bg-plum-light { background: #f3e8ff; }
    .text-white { color: white; }
    .text-red-600 { color: #dc2626; }
    .text-emerald-600 { color: #059669; }
    .text-amber-500 { color: #f59e0b; }
    .rounded-full { border-radius: 9999px; }
    .cursor-pointer { cursor: pointer; }
    button { cursor: pointer; border: none; background: none; }
    a { text-decoration: none; color: inherit; }
    /* Sidebar */
    @media (min-width: 640px) { .sm\\:block { display: block; } .sm\\:hidden { display: none; } .sm\\:border-r { border-right: 1px solid #e5e7eb; } .sm\\:flex-initial { flex: initial; } .sm\\:flex-shrink-0 { flex-shrink: 0; } [style*="--sidebar-desktop-w"] { width: var(--sidebar-desktop-w) !important; } }
    /* Tab-like styles */
    .border-plum { border-color: #7c3aed; }
    pre { background: #f5f5f4; padding: 0.75rem; border-radius: 0.375rem; overflow-x: auto; font-size: 0.8125rem; }
    code { font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
  <div id="root">${html}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const framework = args[0] ?? "zustand";
  const fixtureName = args[1] ?? "fewCommits";

  if (framework === "--help" || framework === "-h") {
    console.log(`Usage: npx tsx src/dev/render-page.tsx <framework> [fixture] [--raw]

Frameworks: ${FRAMEWORKS.join(", ")}
Fixtures:   ${Object.keys(fixtures).join(", ")}
            XState also: ${Object.keys(xstateFixtures).join(", ")}

Options:
  --raw     Output bare HTML fragment (no <html> wrapper)
  -         Read state JSON from stdin instead of using a fixture

Examples:
  npx tsx src/dev/render-page.tsx zustand fewCommits
  npx tsx src/dev/render-page.tsx xstate error
  npx tsx src/dev/render-page.tsx mst fewCommits --raw
  echo '${JSON.stringify({ commits: [], selectedHash: null, loading: true, hasMore: true })}' | npx tsx src/dev/render-page.tsx zustand -`);
    process.exit(0);
  }

  const raw = args.includes("--raw");
  let state: HistoryStateFixture;
  let error: string | null = null;

  if (fixtureName === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    state = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } else if (framework === "xstate" && fixtureName in xstateFixtures) {
    const xf = xstateFixtures[fixtureName]!;
    state = xf.context;
    error = xf.context.error;
  } else if (fixtureName in fixtures) {
    state = fixtures[fixtureName]!;
  } else {
    console.error(`Unknown fixture: ${fixtureName}. Available: ${Object.keys(fixtures).join(", ")}`);
    process.exit(1);
  }

  const html = renderPage({ framework, state, error });
  const title = `${framework} — ${fixtureName}`;

  if (raw) {
    console.log(html);
  } else {
    console.log(wrapInDocument(html, title));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
