/**
 * HistoryPage - Main page for viewing agent run history.
 *
 * Two-panel layout: Sidebar with CommitTimeline (left, collapsible) + CommitDetail (right).
 * URL reflects selected commit plus filter state (connector/workflow/touchpoint/
 * feedback/session) via search params so filtered views are shareable.
 */

import { useState, useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { href } from "../lib/routing";
import type { HistoryCommit } from "../api";
import { trpc } from "../lib/trpc";
import { Sidebar } from "../components/Sidebar";
import { CommitTimeline } from "../components/CommitTimeline";
import { CommitDetail } from "../components/CommitDetail";
import {
  HistoryFilterBar,
  type HistoryFilterState,
} from "../components/HistoryFilterBar";
import { Row } from "../components/ui/Row";
import { VisuallyHidden } from "../components/ui/VisuallyHidden";
import { Column } from "../components/ui/Column";
import { Text } from "../components/ui/Text";

const PAGE_SIZE = 50;

const EMPTY_FILTER: HistoryFilterState = {
  connectors: [],
  workflows: [],
  touchpoint: false,
  feedback: false,
  session: null,
};

interface HistorySearch {
  connector?: string[];
  workflow?: string[];
  touchpoint?: boolean;
  feedback?: boolean;
  session?: string;
}

export function HistoryPage() {
  const params = useParams({ strict: false }) as { hash?: string; boxSlug: string };
  const urlHash = params.hash;
  const boxSlug = params.boxSlug;
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as HistorySearch;

  const filter: HistoryFilterState = useMemo(
    () => ({
      connectors: search.connector ?? [],
      workflows: search.workflow ?? [],
      touchpoint: search.touchpoint ?? false,
      feedback: search.feedback ?? false,
      session: search.session ?? null,
    }),
    [search.connector, search.workflow, search.touchpoint, search.feedback, search.session]
  );

  const filterInput = useMemo(() => {
    const hasAny =
      filter.connectors.length > 0 ||
      filter.workflows.length > 0 ||
      filter.touchpoint ||
      filter.feedback ||
      filter.session !== null;
    if (!hasAny) return;
    return {
      ...(filter.connectors.length > 0 ? { connectors: filter.connectors } : {}),
      ...(filter.workflows.length > 0 ? { workflows: filter.workflows } : {}),
      ...(filter.touchpoint ? { touchpoint: true } : {}),
      ...(filter.feedback ? { feedback: true } : {}),
      ...(filter.session !== null ? { session: filter.session } : {}),
    };
  }, [filter]);

  const [selectedCommit, setSelectedCommit] = useState<HistoryCommit | null>(null);

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    trpc.history.list.useInfiniteQuery(
      { count: PAGE_SIZE, filter: filterInput },
      { getNextPageParam: (lastPage) => lastPage.nextCursor }
    );

  const { data: facets } = trpc.history.facets.useQuery();

  const commits = useMemo(
    () => data?.pages.flatMap((p) => p.commits) ?? [],
    [data]
  );

  // Auto-select when the first page arrives. Re-runs when filter changes
  // because TanStack issues a fresh query (new first page identity).
  const [prevFirstPage, setPrevFirstPage] = useState(data?.pages[0]);
  const firstPage = data?.pages[0];
  if (firstPage !== prevFirstPage) {
    setPrevFirstPage(firstPage);
    if (firstPage && firstPage.commits.length > 0) {
      if (urlHash) {
        const match = firstPage.commits.find((c) => c.hash.startsWith(urlHash));
        setSelectedCommit(match ?? firstPage.commits[0]);
      } else {
        setSelectedCommit(firstPage.commits[0]);
      }
    } else {
      setSelectedCommit(null);
    }
  }

  const loading = isLoading || isFetchingNextPage;

  const handleSelect = (commit: HistoryCommit) => {
    setSelectedCommit(commit);
    navigate({
      to: href(`/${boxSlug}/history/${commit.hash.substring(0, 8)}`),
      search: search as never,
      replace: true,
    });
  };

  const handleLoadMore = () => {
    fetchNextPage();
  };

  const handleFilterChange = useCallback(
    (next: HistoryFilterState) => {
      const nextSearch: HistorySearch = {};
      if (next.connectors.length > 0) nextSearch.connector = next.connectors;
      if (next.workflows.length > 0) nextSearch.workflow = next.workflows;
      if (next.touchpoint) nextSearch.touchpoint = true;
      if (next.feedback) nextSearch.feedback = true;
      if (next.session !== null) nextSearch.session = next.session;
      navigate({ search: nextSearch as never, replace: false });
    },
    [navigate]
  );

  const handleFilterSession = useCallback(
    (sessionId: string) => {
      handleFilterChange({ ...EMPTY_FILTER, ...filter, session: sessionId });
    },
    [filter, handleFilterChange]
  );

  const handleFilterConnector = useCallback(
    (connector: string) => {
      if (filter.connectors.includes(connector)) return;
      handleFilterChange({
        ...filter,
        connectors: [...filter.connectors, connector],
      });
    },
    [filter, handleFilterChange]
  );

  const handleFilterWorkflow = useCallback(
    (workflow: string) => {
      if (filter.workflows.includes(workflow)) return;
      handleFilterChange({
        ...filter,
        workflows: [...filter.workflows, workflow],
      });
    },
    [filter, handleFilterChange]
  );

  const hasDetail = Boolean(selectedCommit);

  return (
    <Row gap="none" align="stretch" className="h-full">
      <VisuallyHidden as="h1">Commits</VisuallyHidden>
      <Sidebar title="Commits" subtitle={`${commits.length} loaded`} detailSelected={hasDetail}>
        <HistoryFilterBar
          filter={filter}
          facets={facets}
          onChange={handleFilterChange}
        />
        <CommitTimeline
          commits={commits}
          selectedHash={selectedCommit?.hash || null}
          onSelect={handleSelect}
          onLoadMore={handleLoadMore}
          onFilterSession={handleFilterSession}
          activeSession={filter.session}
          hasMore={hasNextPage ?? false}
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
            <Text tone="muted">{loading ? "Loading..." : "Select a commit to view details"}</Text>
          </Row>
        )}
      </Column>
    </Row>
  );
}
