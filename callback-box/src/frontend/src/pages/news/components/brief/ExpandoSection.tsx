/**
 * ExpandoSection - Collapsible content section with comment affordance.
 */

import { useState } from "react";
import { Markdown } from "../../../../components/Markdown";
import { MicrophoneIcon } from "../../../../components/VoiceRecorder";
import type { Expando } from "./types";
import { ThumbsFeedback } from "./ThumbsFeedback";
import { InlineVoiceRecorder } from "./InlineVoiceRecorder";
import { InlineAction } from "../../../../components/ui/InlineAction";

export function ExpandoSection({
  expando,
  onComment,
  onVoiceComment,
  feedback,
  onFeedback,
}: {
  expando: Expando;
  onComment?: (id: string, comment: string) => void;
  onVoiceComment?: (id: string, audioBlob: Blob) => Promise<void>;
  feedback?: "thumbs-up" | "thumbs-down";
  onFeedback?: (id: string, value: "thumbs-up" | "thumbs-down" | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmitComment = () => {
    if (comment.trim() && onComment && expando.id) {
      onComment(expando.id, comment);
      setComment("");
      setShowComment(false);
      setSubmitted(true);
    }
  };

  const handleVoiceComplete = async (blob: Blob) => {
    if (onVoiceComment && expando.id) {
      await onVoiceComment(expando.id, blob);
      setShowVoice(false);
      setSubmitted(true);
    }
  };

  return (
    <div className="my-4 border-l-4 border-info-100 bg-info-50 rounded-r-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-info-100 transition-colors"
      >
        <div className="flex items-center">
          <span className="font-medium text-primary-dark">{expando.title}</span>
          {expanded && expando.id && onFeedback ? <ThumbsFeedback id={expando.id} feedback={feedback} onFeedback={onFeedback} /> : null}
        </div>
        <span className="text-primary">{expanded ? "\u2212" : "+"}</span>
      </button>
      {expanded ? <div className="px-4 pb-4">
          <div className="prose prose-sm max-w-none">
            <Markdown>{expando.text}</Markdown>
          </div>
          {/* Comment affordance */}
          <div className="mt-4 pt-4 border-t border-info-100">
            {submitted ? (
              <p className="text-success-dark text-sm">Got it, I'll keep that in mind.</p>
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
                  placeholder="Your thoughts on this..."
                  className="w-full p-2 text-sm border rounded resize-none"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSubmitComment}
                    className="px-3 py-1 bg-primary text-white text-sm rounded hover:bg-primary-dark"
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
              <div className="flex gap-2 text-sm">
                <InlineAction onClick={() => setShowComment(true)}>
                  + Add comment
                </InlineAction>
                {onVoiceComment ? (
                  <InlineAction onClick={() => setShowVoice(true)}>
                    <span className="inline-flex items-center gap-1">
                      <MicrophoneIcon className="w-4 h-4" />
                      Voice
                    </span>
                  </InlineAction>
                ) : null}
              </div>
            )}
          </div>
        </div> : null}
    </div>
  );
}
