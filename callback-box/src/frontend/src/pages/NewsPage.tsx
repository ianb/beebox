/* eslint-disable personal-vibe-check/restrict-component-classes */
/**
 * NewsPage - Full news reading experience.
 *
 * Shows a sidebar with brief index and main area with the selected brief.
 * Supports comments, query responses (text and voice).
 *
 * TODO: refactor to UI primitives to remove the eslint-disable above.
 */

import { useState, useCallback } from "react";
import { NewsIndex, type BriefSummary } from "../components/NewsIndex";
import {
  NewsBriefView,
  type NewsBriefData,
  type BriefReaction,
} from "../components/NewsBriefView";
import { Sidebar } from "../components/Sidebar";
import { cbSource } from "../lib/source-tag";
import { trpc } from "../lib/trpc";

/**
 * Convert a Blob to base64 string.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Extended brief data including curation reactions.
 */
interface BriefWithReactions extends NewsBriefData {
  briefReactions: BriefReaction[];
}

interface NewsPageProps {
  /** Optional path to load initially (from URL) */
  initialPath?: string;
  /** Called when a source is clicked */
  onSourceClick?: (sourcePath: string) => void;
  /** Called when URL should update */
  onNavigate?: (path: string | null) => void;
}

export function NewsPage({ initialPath, onSourceClick, onNavigate }: NewsPageProps) {
  const [selectedSummary, setSelectedSummary] = useState<BriefSummary | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  // The path to fetch — either from selection or initial URL
  const briefPath = selectedSummary?.relativePath ?? initialPath ?? null;

  // Fetch brief data
  const briefQuery = trpc.briefs.get.useQuery(
    { path: briefPath! },
    { enabled: !!briefPath }
  );

  // Fetch guide reactions
  const guideReactionsQuery = trpc.briefs.guideReactions.useQuery();

  // Mutations
  const feedbackMutation = trpc.briefs.feedback.useMutation();
  const queryResponseMutation = trpc.briefs.queryResponse.useMutation();
  const completeReadingMutation = trpc.briefs.completeReading.useMutation();

  const utils = trpc.useUtils();

  // Derive brief with reactions from query data
  const briefData: BriefWithReactions | null = briefQuery.data
    ? {
        ...briefQuery.data.brief,
        briefReactions: (briefQuery.data.brief as { curation?: { briefReactions?: BriefReaction[] } }).curation?.briefReactions ?? [],
      }
    : null;

  const guideReactions = guideReactionsQuery.data?.reactions ?? [];

  // Determine read status for initial path
  const isUnread = selectedSummary
    ? !selectedSummary.read
    : initialPath
      ? initialPath.includes("box/output/briefs/")
      : false;

  // Handle brief selection
  const handleSelect = useCallback(
    (summary: BriefSummary) => {
      setSelectedSummary(summary);
      onNavigate?.(summary.relativePath);
    },
    [onNavigate]
  );

  // Handle completion of reading with feedback
  const handleCompleteReading = useCallback(
    async (data: {
      overallRating: "great" | "ok" | "meh";
      selectedReactions: Array<{ id: string; source: "guide" | "brief" }>;
      itemFeedback: Array<{ id: string; feedback: "thumbs-up" | "thumbs-down" }>;
    }) => {
      if (!briefPath) return;

      const result = await completeReadingMutation.mutateAsync({
        briefPath,
        overallRating: data.overallRating,
        selectedReactions: data.selectedReactions,
        itemFeedback: data.itemFeedback,
      });

      // Update the summary to show as read with new archived path
      setSelectedSummary((prev) => prev ? {
        ...prev,
        read: true,
        path: result.newPath,
        relativePath: result.newPath,
      } : null);

      // Refresh the sidebar list
      setSidebarRefreshKey((k) => k + 1);
      utils.briefs.invalidate();
    },
    [briefPath, completeReadingMutation, utils.briefs]
  );

  // Handle text comment submission
  const handleComment = useCallback(
    (targetId: string, comment: string) => {
      if (!briefPath) return;

      feedbackMutation.mutate({
        briefPath,
        targetId,
        comment,
      });
    },
    [briefPath, feedbackMutation]
  );

  // Handle voice comment submission
  const handleVoiceComment = useCallback(
    async (targetId: string, audioBlob: Blob) => {
      if (!briefPath) return;

      const audioData = await blobToBase64(audioBlob);
      await feedbackMutation.mutateAsync({
        briefPath,
        targetId,
        audioData,
        audioMimeType: audioBlob.type,
      });
    },
    [briefPath, feedbackMutation]
  );

  // Handle text query response
  const handleQueryResponse = useCallback(
    (queryId: string, response: string) => {
      if (!briefPath) return;

      queryResponseMutation.mutate({
        briefPath,
        queryId,
        response,
      });
    },
    [briefPath, queryResponseMutation]
  );

  // Handle voice query response
  const handleVoiceQueryResponse = useCallback(
    async (queryId: string, audioBlob: Blob) => {
      if (!briefPath) return;

      const audioData = await blobToBase64(audioBlob);
      await queryResponseMutation.mutateAsync({
        briefPath,
        queryId,
        audioData,
        audioMimeType: audioBlob.type,
      });
    },
    [briefPath, queryResponseMutation]
  );

  const handleBack = useCallback(() => {
    setSelectedSummary(null);
    onNavigate?.(null);
  }, [onNavigate]);

  const loading = briefQuery.isLoading && !!briefPath;
  const error = briefQuery.error?.message ?? null;
  const hasDetail = Boolean(briefData || loading || error);

  return (
    <div className="h-full flex">
      {/* Sidebar with index */}
      <Sidebar title="News Briefs" detailSelected={hasDetail}>
        <NewsIndex onSelect={handleSelect} selectedPath={selectedSummary?.path ?? initialPath} refreshKey={sidebarRefreshKey} />
      </Sidebar>

      {/* Main content — hidden on mobile when no detail selected */}
      <div className={`flex-1 overflow-auto bg-warm-50 ${hasDetail ? "" : "hidden sm:block"}`}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-warm-600">Loading...</div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-danger-dark">Error: {error}</div>
          </div>
        ) : briefData ? (
          <div {...(briefPath ? cbSource("card", briefPath) : {})}>
            <button
              onClick={handleBack}
              className="sm:hidden flex items-center gap-1 px-3 py-2 text-sm text-primary hover:text-primary-dark"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to briefs
            </button>
            <NewsBriefView
              brief={briefData}
              briefPath={briefPath ?? undefined}
              onComment={handleComment}
              onVoiceComment={handleVoiceComment}
              onQueryResponse={handleQueryResponse}
              onVoiceQueryResponse={handleVoiceQueryResponse}
              onSourceClick={onSourceClick}
              guideReactions={guideReactions}
              briefReactions={briefData.briefReactions}
              onCompleteReading={isUnread ? handleCompleteReading : undefined}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-warm-500">
            Select a brief to read
          </div>
        )}
      </div>
    </div>
  );
}

export default NewsPage;
