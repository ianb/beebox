/**
 * The history surface: two-pane commit timeline + detail, over a
 * caller-supplied filter. Self-contained except for filter state, which is
 * deliberately controlled — the History page keeps it in URL search params
 * (shareable), a `view: history` card freezes it in frontmatter (a saved
 * filter). Every filter interaction (the bar, chips in the timeline and
 * detail) flows through `onFilterChange`; the card wrapper turns those
 * into navigation to the History page.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import type { HistoryCommit } from "../../api";
import { trpc } from "../../lib/trpc";
import { Sidebar } from "../Sidebar";
import { CommitTimeline } from "./CommitTimeline";
import { CommitDetail } from "./CommitDetail";
import { HistoryFilterBar, type HistoryFilterState } from "./HistoryFilterBar";
import { Row } from "../ui/Row";
import { Column } from "../ui/Column";
import { Text } from "../ui/Text";
import { EMPTY_FILTER } from "./history-filter";

const PAGE_SIZE = 50;

interface HistoryBrowserProps {
  filter: HistoryFilterState;
  /** Receives every filter interaction (bar edits, session/connector/workflow chips). */
  onFilterChange: (next: HistoryFilterState) => void;
  /** Show the interactive filter bar (the page); cards hide it — their filter is the card. */
  filterBar: boolean;
  /** Commit-hash prefix to auto-select on first load (the page's /history/$hash). */
  initialHash?: string;
  /** Selection sync (the page reflects it into the URL); omit for local-only selection. */
  onSelectCommit?: (commit: HistoryCommit) => void;
}

export function HistoryBrowser({
  filter,
  onFilterChange,
  filterBar,
  initialHash,
  onSelectCommit,
}: HistoryBrowserProps) {
  const filterInput = useMemo(() => {
    const hasAny =
      filter.connectors.length > 0 ||
      filter.workflows.length > 0 ||
      filter.touchpoint ||
      filter.feedback ||
      filter.session !== null ||
      filter.path !== null;
    if (!hasAny) return;
    return {
      ...(filter.connectors.length > 0 ? { connectors: filter.connectors } : {}),
      ...(filter.workflows.length > 0 ? { workflows: filter.workflows } : {}),
      ...(filter.touchpoint ? { touchpoint: true } : {}),
      ...(filter.feedback ? { feedback: true } : {}),
      ...(filter.session !== null ? { session: filter.session } : {}),
      ...(filter.path !== null ? { path: filter.path } : {}),
    };
  }, [filter]);

  const [selectedCommit, setSelectedCommit] = useState<HistoryCommit | null>(null);

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    trpc.history.list.useInfiniteQuery(
      { count: PAGE_SIZE, filter: filterInput },
      { getNextPageParam: (lastPage) => lastPage.nextCursor }
    );

  const facetsQuery = trpc.history.facets.useQuery(undefined, { enabled: filterBar });

  const commits = useMemo(
    () => data?.pages.flatMap((p) => p.commits) ?? [],
    [data]
  );

  // A deep link names one commit. Until it is found, nothing else may be selected in its place:
  // falling back to the newest commit made `/history/<old-hash>` render a DIFFERENT commit with no
  // error, so a shared link read as though it had resolved.
  const [deepLinkPending, setDeepLinkPending] = useState(Boolean(initialHash));

  // Auto-select when the first page arrives. Re-runs when filter changes
  // because TanStack issues a fresh query (new first page identity).
  const [prevFirstPage, setPrevFirstPage] = useState(data?.pages[0]);
  const firstPage = data?.pages[0];
  if (firstPage !== prevFirstPage) {
    setPrevFirstPage(firstPage);
    const [firstCommit] = firstPage?.commits ?? [];
    if (initialHash && deepLinkPending) {
      // Search everything loaded so far, not just this page — the commit may arrive several
      // pages in, and the search must not restart from scratch each time one lands.
      const match = commits.find((c) => c.hash.startsWith(initialHash));
      if (match !== undefined) {
        setSelectedCommit(match);
        setDeepLinkPending(false);
      }
    } else if (firstCommit !== undefined) {
      setSelectedCommit(firstCommit);
    } else {
      setSelectedCommit(null);
    }
  }

  // Keep paging until the deep-linked commit turns up or the history runs out. Without this the
  // hash simply never resolves for anything past the first page.
  useEffect(() => {
    if (!deepLinkPending || !initialHash) return;
    if (commits.some((c) => c.hash.startsWith(initialHash))) return;
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [deepLinkPending, initialHash, commits, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Ran out of history without finding it: say so rather than showing some other commit.
  const deepLinkMissing = deepLinkPending && Boolean(initialHash) && !hasNextPage && !isFetchingNextPage && commits.length > 0;

  const loading = isLoading || isFetchingNextPage;

  const handleSelect = (commit: HistoryCommit) => {
    setSelectedCommit(commit);
    onSelectCommit?.(commit);
  };

  const handleFilterSession = useCallback(
    (sessionId: string) => {
      onFilterChange({ ...EMPTY_FILTER, ...filter, session: sessionId });
    },
    [filter, onFilterChange]
  );

  const handleFilterConnector = useCallback(
    (connector: string) => {
      if (filter.connectors.includes(connector)) return;
      onFilterChange({
        ...filter,
        connectors: [...filter.connectors, connector],
      });
    },
    [filter, onFilterChange]
  );

  const handleFilterWorkflow = useCallback(
    (workflow: string) => {
      if (filter.workflows.includes(workflow)) return;
      onFilterChange({
        ...filter,
        workflows: [...filter.workflows, workflow],
      });
    },
    [filter, onFilterChange]
  );

  const hasDetail = Boolean(selectedCommit);

  return (
    <Row gap="none" align="stretch" className="h-full">
      <Sidebar title="Commits" subtitle={`${commits.length} loaded`} detailSelected={hasDetail} idPrefix="bbx-history-sidebar">
        {filterBar ? (
          <HistoryFilterBar
            filter={filter}
            facets={facetsQuery.data}
            onChange={onFilterChange}
          />
        ) : null}
        <CommitTimeline
          commits={commits}
          selectedHash={selectedCommit?.hash || null}
          onSelect={handleSelect}
          onLoadMore={() => void fetchNextPage()}
          onFilterSession={handleFilterSession}
          activeSession={filter.session}
          hasMore={hasNextPage}
          loading={loading}
        />
      </Sidebar>

      <Column overflow="hidden" hideOnMobile={!hasDetail} className="flex-1">
        {selectedCommit ? (
          <CommitDetail
            commit={selectedCommit}
            onBack={() => setSelectedCommit(null)}
            onFilterSession={handleFilterSession}
            onFilterConnector={handleFilterConnector}
            onFilterWorkflow={handleFilterWorkflow}
          />
        ) : (
          <Row justify="center" align="center" className="h-full">
            <Text tone={deepLinkMissing ? "danger" : "muted"}>
              {deepLinkMissing
                ? `No commit in this box's history starts with ${initialHash}.`
                : (deepLinkPending && initialHash
                  ? `Looking for commit ${initialHash}…`
                  : (loading ? "Loading..." : "Select a commit to view details"))}
            </Text>
          </Row>
        )}
      </Column>
    </Row>
  );
}
