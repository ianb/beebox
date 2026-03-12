/**
 * ContentSection - Major content division with heading, text, expandos, queries, excerpts.
 */

import { useState } from "react";
import { Markdown } from "../Markdown";
import { MicrophoneIcon } from "../VoiceRecorder";
import type { Section } from "./types";
import { ThumbsFeedback } from "./ThumbsFeedback";
import { ExpandoSection } from "./ExpandoSection";
import { QueryPrompt } from "./QueryPrompt";
import { ExcerptBlock } from "./ExcerptBlock";
import { InlineVoiceRecorder } from "./InlineVoiceRecorder";

export function ContentSection({
  section,
  onComment,
  onVoiceComment,
  onQueryResponse,
  onVoiceQueryResponse,
  itemFeedback,
  onItemFeedback,
}: {
  section: Section;
  onComment?: (id: string, comment: string) => void;
  onVoiceComment?: (id: string, audioBlob: Blob) => Promise<void>;
  onQueryResponse?: (id: string, response: string) => void;
  onVoiceQueryResponse?: (id: string, audioBlob: Blob) => Promise<void>;
  itemFeedback?: Map<string, "thumbs-up" | "thumbs-down">;
  onItemFeedback?: (id: string, value: "thumbs-up" | "thumbs-down" | undefined) => void;
}) {
  const [showComment, setShowComment] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmitComment = () => {
    if (comment.trim() && onComment && section.id) {
      onComment(section.id, comment);
      setComment("");
      setShowComment(false);
      setSubmitted(true);
    }
  };

  const handleVoiceComplete = async (blob: Blob) => {
    if (onVoiceComment && section.id) {
      await onVoiceComment(section.id, blob);
      setShowVoice(false);
      setSubmitted(true);
    }
  };

  return (
    <div className="mb-8" data-section-id={section.id}>
      {section.heading ? <div className="flex items-center justify-between mb-2 pb-2 border-b">
          <div className="flex items-center">
            <h2 className="text-xl font-semibold text-warm-800">
              {section.link ? (
                <a href={section.link} target="_blank" rel="noopener noreferrer" className="hover:text-plum-dark">
                  {section.heading}
                </a>
              ) : section.heading}
            </h2>
            {section.id && onItemFeedback ? <ThumbsFeedback
                id={section.id}
                feedback={itemFeedback?.get(section.id)}
                onFeedback={onItemFeedback}
              /> : null}
          </div>
          {section.via ? <span className="text-xs text-warm-500 ml-4">
              via {section.via}
            </span> : null}
        </div> : null}
      {section.text ? <div className="prose prose-sm max-w-none mb-4">
          <Markdown>{section.text}</Markdown>
        </div> : null}
      {section.excerpts.map((excerpt, i) => (
        <ExcerptBlock key={i} excerpt={excerpt} />
      ))}
      {section.expandos.map((expando, i) => (
        <ExpandoSection
          key={expando.id ?? i}
          expando={expando}
          onComment={onComment}
          onVoiceComment={onVoiceComment}
          feedback={expando.id ? itemFeedback?.get(expando.id) : undefined}
          onFeedback={onItemFeedback}
        />
      ))}
      {section.queries.map((query, i) => (
        <QueryPrompt
          key={query.id ?? i}
          query={query}
          onResponse={onQueryResponse}
          onVoiceResponse={onVoiceQueryResponse}
        />
      ))}
      {/* Section comment affordance */}
      {section.id && (onComment || onVoiceComment) ? <div className="mt-3 pt-3 border-t border-warm-200">
          {submitted ? (
            <p className="text-green-700 text-sm">Got it, I'll keep that in mind.</p>
          ) : showVoice ? (
            <InlineVoiceRecorder
              onComplete={handleVoiceComplete}
              onCancel={() => setShowVoice(false)}
            />
          ) : showComment ? (
            <div className="space-y-2">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={`Your thoughts on "${section.heading ?? "this section"}"...`}
                className="w-full p-2 text-sm border rounded resize-none"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSubmitComment}
                  className="px-3 py-1 bg-plum text-white text-sm rounded hover:bg-plum-dark"
                >
                  Comment
                </button>
                {onVoiceComment ? <button
                    onClick={() => {
                      setShowComment(false);
                      setShowVoice(true);
                    }}
                    className="px-3 py-1 border border-warm-400 text-warm-700 text-sm rounded hover:bg-warm-50 flex items-center gap-1"
                  >
                    <MicrophoneIcon className="w-4 h-4" />
                    Voice
                  </button> : null}
                <button
                  onClick={() => setShowComment(false)}
                  className="px-3 py-1 text-warm-700 text-sm hover:text-warm-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setShowComment(true)}
                className="text-sm text-warm-500 hover:text-plum"
              >
                + Add comment
              </button>
              {onVoiceComment ? <button
                  onClick={() => setShowVoice(true)}
                  className="text-sm text-warm-500 hover:text-plum flex items-center gap-1"
                >
                  <MicrophoneIcon className="w-4 h-4" />
                  Voice
                </button> : null}
            </div>
          )}
        </div> : null}
    </div>
  );
}
