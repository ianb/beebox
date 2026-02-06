/**
 * NewsBriefView - Main orchestrator for rendering a news brief.
 *
 * Wires together sub-components: ContentSection, ExpandoSection, QueryPrompt,
 * ExcerptBlock, SourceList, ReadingFeedback, and InlineVoiceRecorder.
 */

import { useState, useCallback } from "react";
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
  onComment,
  onVoiceComment,
  onQueryResponse,
  onVoiceQueryResponse,
  onSourceClick,
  guideReactions = [],
  briefReactions = [],
  onCompleteReading,
}: NewsBriefViewProps) {
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
        <time className="text-sm text-gray-500 block mb-2">
          {new Date(brief.date).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">{brief.title}</h1>
        {brief.byline && <p className="text-lg text-gray-600 italic">{brief.byline}</p>}
      </header>

      {/* Main content */}
      <div className="prose prose-lg max-w-none mb-8">
        {brief.content.text && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.content.text}</ReactMarkdown>
        )}

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

      {/* Reading completion feedback */}
      <div className="mt-8 pt-6 border-t border-gray-200">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          Finish Reading
        </h3>
        {completed ? (
          <p className="text-green-700">Thanks for your feedback!</p>
        ) : globalSubmitted ? (
          <p className="text-green-700">Got it, I'll keep that in mind.</p>
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
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Submit Comment
              </button>
              {onVoiceComment && (
                <button
                  onClick={() => {
                    setShowGlobalComment(false);
                    setShowGlobalVoice(true);
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 flex items-center gap-1"
                >
                  <MicrophoneIcon className="w-4 h-4" />
                  Voice
                </button>
              )}
              <button
                onClick={() => setShowGlobalComment(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : onCompleteReading ? (
          <ReadingFeedback
            guideReactions={guideReactions}
            briefReactions={briefReactions}
            onComplete={handleCompleteReading}
            onShowComment={() => setShowGlobalComment(true)}
            onShowVoice={onVoiceComment ? () => setShowGlobalVoice(true) : undefined}
          />
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => setShowGlobalComment(true)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Share your thoughts on this brief
            </button>
            {onVoiceComment && (
              <button
                onClick={() => setShowGlobalVoice(true)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-1"
              >
                <MicrophoneIcon className="w-4 h-4" />
                Voice Feedback
              </button>
            )}
          </div>
        )}
      </div>
    </article>

    {/* Fixed bottom voice recorder for global feedback */}
    {showGlobalVoice && (
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-50">
        <div className="max-w-3xl mx-auto">
          <InlineVoiceRecorder
            onComplete={handleGlobalVoice}
            onCancel={() => setShowGlobalVoice(false)}
          />
        </div>
      </div>
    )}
  </>
  );
}
