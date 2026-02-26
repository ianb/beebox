/**
 * NewsBriefView - Main orchestrator for rendering a news brief.
 *
 * Wires together sub-components: ContentSection, ExpandoSection, QueryPrompt,
 * ExcerptBlock, SourceList, ReadingFeedback, and InlineVoiceRecorder.
 */

import { useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MicrophoneIcon } from "../VoiceRecorder";
import type { NewsBriefData, GuideReaction, BriefReaction } from "./types";
import { ContentSection } from "./ContentSection";
import { ExpandoSection } from "./ExpandoSection";
import { QueryPrompt } from "./QueryPrompt";
import { ExcerptBlock } from "./ExcerptBlock";
import { SourceList } from "./SourceList";
import { ReadingFeedback } from "./ReadingFeedback";
import { InlineVoiceRecorder } from "./InlineVoiceRecorder";

interface NewsBriefViewProps {
  brief: NewsBriefData;
  briefPath?: string;
  onComment?: (targetId: string, comment: string) => void;
  onVoiceComment?: (targetId: string, audioBlob: Blob) => Promise<void>;
  onQueryResponse?: (queryId: string, response: string) => void;
  onVoiceQueryResponse?: (queryId: string, audioBlob: Blob) => Promise<void>;
  onSourceClick?: (sourcePath: string) => void;
  guideReactions?: GuideReaction[];
  briefReactions?: BriefReaction[];
  onCompleteReading?: (data: {
    overallRating: "great" | "ok" | "meh";
    selectedReactions: Array<{ id: string; source: "guide" | "brief" }>;
    itemFeedback: Array<{ id: string; feedback: "thumbs-up" | "thumbs-down" }>;
  }) => Promise<void>;
}

export function NewsBriefView({
  brief,
  briefPath,
  onComment,
  onVoiceComment,
  onQueryResponse,
  onVoiceQueryResponse,
  onSourceClick,
  guideReactions = [],
  briefReactions = [],
  onCompleteReading,
}: NewsBriefViewProps) {
  const { boxSlug } = useParams();
  const [showGlobalComment, setShowGlobalComment] = useState(false);
  const [showGlobalVoice, setShowGlobalVoice] = useState(false);
  const [globalComment, setGlobalComment] = useState("");
  const [globalSubmitted, setGlobalSubmitted] = useState(false);
  const [itemFeedback, setItemFeedback] = useState<Map<string, "thumbs-up" | "thumbs-down">>(new Map());
  const [completed, setCompleted] = useState(false);

  const handleItemFeedback = useCallback((id: string, value: "thumbs-up" | "thumbs-down" | undefined) => {
    setItemFeedback((prev) => {
      const next = new Map(prev);
      if (value === undefined) {
        next.delete(id);
      } else {
        next.set(id, value);
      }
      return next;
    });
  }, []);

  const handleCompleteReading = useCallback(
    async (rating: "great" | "ok" | "meh", selectedReactions: Array<{ id: string; source: "guide" | "brief" }>) => {
      if (onCompleteReading) {
        const feedbackArray = Array.from(itemFeedback.entries()).map(([id, feedback]) => ({
          id,
          feedback,
        }));

        await onCompleteReading({
          overallRating: rating,
          selectedReactions,
          itemFeedback: feedbackArray,
        });
        setCompleted(true);
      }
    },
    [onCompleteReading, itemFeedback]
  );

  const handleGlobalComment = useCallback(() => {
    if (globalComment.trim() && onComment) {
      onComment("global", globalComment);
      setGlobalComment("");
      setShowGlobalComment(false);
      setGlobalSubmitted(true);
    }
  }, [globalComment, onComment]);

  const handleGlobalVoice = useCallback(
    async (blob: Blob) => {
      if (onVoiceComment) {
        await onVoiceComment("global", blob);
        setShowGlobalVoice(false);
        setGlobalSubmitted(true);
      }
    },
    [onVoiceComment]
  );

  return (
    <>
    <article className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <time className="text-sm text-warm-600 block mb-2">
          {new Date(brief.date).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
        <h1 className="text-3xl font-bold text-warm-900 mb-3">{brief.title}</h1>
        {brief.byline ? <p className="text-lg text-warm-700 italic">{brief.byline}</p> : null}
        {briefPath ? (
          <Link to={`/${boxSlug}/print/${briefPath}`} className="text-sm text-warm-500 hover:text-warm-700 mt-2 inline-block">
            Print view
          </Link>
        ) : null}
      </header>

      {/* Main content */}
      <div className="prose prose-lg max-w-none mb-8">
        {brief.content.text ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.content.text}</ReactMarkdown>
        ) : null}

        {brief.content.sections.map((section, i) => (
          <ContentSection
            key={section.id ?? i}
            section={section}
            onComment={onComment}
            onVoiceComment={onVoiceComment}
            onQueryResponse={onQueryResponse}
            onVoiceQueryResponse={onVoiceQueryResponse}
            itemFeedback={itemFeedback}
            onItemFeedback={handleItemFeedback}
          />
        ))}

        {brief.content.excerpts.map((excerpt, i) => (
          <ExcerptBlock key={i} excerpt={excerpt} />
        ))}

        {brief.content.expandos.map((expando, i) => (
          <ExpandoSection
            key={expando.id ?? i}
            expando={expando}
            onComment={onComment}
            onVoiceComment={onVoiceComment}
            feedback={expando.id ? itemFeedback.get(expando.id) : undefined}
            onFeedback={handleItemFeedback}
          />
        ))}

        {brief.content.queries.map((query, i) => (
          <QueryPrompt
            key={query.id ?? i}
            query={query}
            onResponse={onQueryResponse}
            onVoiceResponse={onVoiceQueryResponse}
          />
        ))}
      </div>

      {/* Sources */}
      <SourceList sources={brief.sources} onSourceClick={onSourceClick} />

      {/* Global comment / voice feedback */}
      {!completed && (
        <div className="mt-8 pt-6 border-t border-warm-300">
          {globalSubmitted ? (
            <p className="text-green-700 text-sm">Got it, I'll keep that in mind.</p>
          ) : showGlobalComment ? (
            <div className="space-y-3">
              <textarea
                value={globalComment}
                onChange={(e) => setGlobalComment(e.target.value)}
                placeholder="What did you think of this brief? What did you learn? What would you like to see more or less of?"
                className="w-full p-3 border rounded-lg resize-none"
                rows={4}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleGlobalComment}
                  className="px-4 py-2 bg-plum text-white rounded hover:bg-plum-dark"
                >
                  Submit Comment
                </button>
                {onVoiceComment ? (
                  <button
                    onClick={() => {
                      setShowGlobalComment(false);
                      setShowGlobalVoice(true);
                    }}
                    className="px-4 py-2 border border-warm-400 text-warm-700 rounded hover:bg-warm-50 flex items-center gap-1"
                  >
                    <MicrophoneIcon className="w-4 h-4" />
                    Voice
                  </button>
                ) : null}
                <button
                  onClick={() => setShowGlobalComment(false)}
                  className="px-4 py-2 text-warm-700 hover:text-warm-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setShowGlobalComment(true)}
                className="text-sm text-warm-500 hover:text-plum"
              >
                + Add a comment about this brief
              </button>
              {onVoiceComment ? (
                <button
                  onClick={() => setShowGlobalVoice(true)}
                  className="text-sm text-warm-500 hover:text-plum flex items-center gap-1"
                >
                  <MicrophoneIcon className="w-4 h-4" />
                  Voice
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Reading completion feedback */}
      <div className="mt-6 pt-6 border-t border-warm-300">
        <h3 className="text-sm font-semibold text-warm-700 uppercase tracking-wide mb-3">
          Finish Reading
        </h3>
        {completed ? (
          <p className="text-green-700">Thanks for your feedback!</p>
        ) : onCompleteReading ? (
          <ReadingFeedback
            guideReactions={guideReactions}
            briefReactions={briefReactions}
            onComplete={handleCompleteReading}
          />
        ) : null}
      </div>
    </article>

    {/* Fixed bottom voice recorder for global feedback */}
    {showGlobalVoice ? (
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-warm-300 shadow-lg p-4 z-50">
        <div className="max-w-3xl mx-auto">
          <InlineVoiceRecorder
            onComplete={handleGlobalVoice}
            onCancel={() => setShowGlobalVoice(false)}
          />
        </div>
      </div>
    ) : null}
  </>
  );
}
