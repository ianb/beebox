/**
 * HistoryPage - Main page for viewing agent run history.
 *
 * Two-panel layout: Sidebar with CommitTimeline (left, collapsible) + CommitDetail (right).
 * URL reflects selected commit: /history/:hash
 */

import { useState, useMemo } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { href } from "../lib/routing";
import type { HistoryCommit } from "../api";
import { trpc } from "../lib/trpc";
import { Sidebar } from "../components/Sidebar";
import { CommitTimeline } from "../components/CommitTimeline";
import { CommitDetail } from "../components/CommitDetail";
import { Row } from "../components/ui/Row";
import { Column } from "../components/ui/Column";
import { Text } from "../components/ui/Text";

const PAGE_SIZE = 50;

export function HistoryPage() {
  const params = useParams({ strict: false }) as { hash?: string; boxSlug: string };
  const urlHash = params.hash;
  const boxSlug = params.boxSlug;
  const navigate = useNavigate();
  const [selectedCommit, setSelectedCommit] = useState<HistoryCommit | null>(null);

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    trpc.history.list.useInfiniteQuery(
      { count: PAGE_SIZE },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }
    );

  const commits = useMemo(
    () => data?.pages.flatMap((p) => p.commits) ?? [],
    [data]
  );

  // Auto-select when initial data arrives (setState during render — React-approved pattern)
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
    }
  }

  const loading = isLoading || isFetchingNextPage;

  const handleSelect = (commit: HistoryCommit) => {
    setSelectedCommit(commit);
    navigate({ to: href(`/${boxSlug}/history/${commit.hash.substring(0, 8)}`), replace: true });
  };

  const handleLoadMore = () => {
    fetchNextPage();
  };

  const hasDetail = Boolean(selectedCommit);

  return (
    <Row gap="none" align="stretch" className="h-full">
      <Sidebar title="Commits" subtitle={`${commits.length} loaded`} detailSelected={hasDetail}>
        <CommitTimeline
          commits={commits}
          selectedHash={selectedCommit?.hash || null}
          onSelect={handleSelect}
          onLoadMore={handleLoadMore}
          hasMore={hasNextPage ?? false}
          loading={loading}
        />
      </Sidebar>

      <Column overflow="hidden" hideOnMobile={!hasDetail} className="flex-1">
        {selectedCommit ? (
          <CommitDetail commit={selectedCommit} onBack={() => setSelectedCommit(null)} />
        ) : (
          <Row justify="center" align="center" className="h-full">
            <Text tone="muted">{loading ? "Loading..." : "Select a commit to view details"}</Text>
          </Row>
        )}
      </Column>
    </Row>
  );
}
