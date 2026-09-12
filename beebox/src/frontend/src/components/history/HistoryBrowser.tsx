/**
 * The history surface: two-pane commit timeline + detail, over a
 * caller-supplied filter and selected commit. Both are controlled so the
 * containing view card can persist them in its ViewState.
 */

import { useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import type { HistoryCommit } from "../../api";
import { trpc } from "../../lib/trpc";
import { Sidebar } from "../Sidebar";
import { CommitTimeline } from "./CommitTimeline";
import { HistoryFilterBar, type HistoryFilterState } from "./HistoryFilterBar";
import { Row } from "../ui/Row";
import { Column } from "../ui/Column";
import { Text } from "../ui/Text";
import { EMPTY_FILTER } from "./history-filter";
import { historySelectionMissing, resolveHistorySelection } from "./history-selection";

const CommitDetail = lazy(async () => {
  const module = await import("./CommitDetail");
  return { default: module.CommitDetail };
});

const PAGE_SIZE = 50;

interface HistoryBrowserProps {
  filter: HistoryFilterState;
  /** Receives every filter interaction (bar edits, session/connector/workflow chips). */
  onFilterChange: (next: HistoryFilterState) => void;
  /** Show the interactive filter bar. */
  filterBar: boolean;
  /** Controlled commit-hash prefix; undefined selects newest, null keeps the timeline clear. */
  selectedHash?: string | null;
  /** Persists timeline/detail selection in the containing card's view state. */
  onSelectedHashChange?: (hash: string | null) => void;
  idPrefix: string;
}

export function HistoryBrowser({
  filter,
  onFilterChange,
  filterBar,
  selectedHash,
  onSelectedHashChange,
  idPrefix,
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


  const { data, isLoading, isError, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
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
  const selection = resolveHistorySelection(commits, selectedHash);
  const selectedCommit = selection.kind === "selected" ? selection.commit : null;
  const deepLinkPending = selection.kind === "pending" && typeof selectedHash === "string";

  // Keep paging until the deep-linked commit turns up or the history runs out. Without this the
  // hash simply never resolves for anything past the first page.
  useEffect(() => {
    if (!deepLinkPending || typeof selectedHash !== "string") return;
    if (commits.some((c) => c.hash.startsWith(selectedHash))) return;
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [deepLinkPending, selectedHash, commits, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Ran out of history without finding it: say so rather than showing some other commit.
  const deepLinkMissing = !isError && historySelectionMissing({
    selection, selectedHash, loading: isLoading || isFetchingNextPage, hasNextPage,
  });

  const loading = isLoading || isFetchingNextPage;

  const handleSelect = (commit: HistoryCommit) => {
    onSelectedHashChange?.(commit.hash);
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
      <Sidebar title="Commits" headingLevel="h2" subtitle={`${commits.length} loaded`} detailSelected={hasDetail} idPrefix={`${idPrefix}-sidebar`}>
        {filterBar && facetsQuery.isError ? <div className="px-3 py-2"><Text size="sm" tone="danger">History filters could not be loaded. <button id={`${idPrefix}-facets-retry`} type="button" className="underline" onClick={() => void facetsQuery.refetch()}>Retry</button></Text></div> : null}
        {filterBar ? (
          <HistoryFilterBar
            filter={filter}
            facets={facetsQuery.data}
            onChange={onFilterChange} idPrefix={`${idPrefix}-filter`}
          />
        ) : null}
        {!hasDetail && (isError || deepLinkMissing) ? <div className="px-3 py-2 md:hidden"><Text size="sm" tone="danger">{isError ? <>History could not be loaded: {error.message} <button id={`${idPrefix}-list-retry-mobile`} type="button" className="underline" onClick={() => void refetch()}>Retry</button></> : `No commit in this box's history starts with ${selectedHash}.`}</Text></div> : null}
        <CommitTimeline
          commits={commits}
          selectedHash={selectedCommit?.hash || null}
          onSelect={handleSelect}
          onLoadMore={() => void fetchNextPage()}
          onFilterSession={handleFilterSession}
          activeSession={filter.session}
          hasMore={hasNextPage}
          loading={loading}
          idPrefix={idPrefix}
        />
      </Sidebar>

      <Column overflow="hidden" hideOnMobile={!hasDetail} className="flex-1">
        {selectedCommit ? (
          <Suspense fallback={<Row justify="center" align="center" className="h-full"><Text tone="muted">Loading commit…</Text></Row>}><CommitDetail
            commit={selectedCommit}
            onBack={() => onSelectedHashChange?.(null)}
            onFilterSession={handleFilterSession}
            onFilterConnector={handleFilterConnector}
            onFilterWorkflow={handleFilterWorkflow}
            idPrefix={idPrefix}
          /></Suspense>
        ) : (
          <Row justify="center" align="center" className="h-full">
            <Text tone={deepLinkMissing || isError ? "danger" : "muted"}>
              {isError ? <>History could not be loaded: {error.message} <button id={`${idPrefix}-list-retry`} type="button" className="underline" onClick={() => void refetch()}>Retry</button></>
                : deepLinkMissing
                ? `No commit in this box's history starts with ${selectedHash}.`
                : (deepLinkPending && typeof selectedHash === "string"
                  ? `Looking for commit ${selectedHash}…`
                  : (loading ? "Loading..." : "Select a commit to view details"))}
            </Text>
          </Row>
        )}
      </Column>
    </Row>
  );
}
