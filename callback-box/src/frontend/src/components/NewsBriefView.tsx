/**
 * NewsBriefView - Renders a news brief with interactive elements.
 *
 * Supports:
 * - Markdown content rendering
 * - Expandable sections (expandos)
 * - Query prompts for user input (text or voice)
 * - Paragraph-level comment affordances (text or voice)
 * - Source references
 */

import { useState, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useVoiceRecorder, type VoiceRecordingResult } from "../hooks/useVoiceRecorder";
import {
  MicrophoneIcon,
  StopIcon,
  RecordingIndicator,
  UploadingIndicator,
} from "./VoiceRecorder";

/**
 * Thumbs up icon.
 */
function ThumbsUpIcon({ className = "w-4 h-4", filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
      />
    </svg>
  );
}

/**
 * Thumbs down icon.
 */
function ThumbsDownIcon({ className = "w-4 h-4", filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.737 3h4.017c.163 0 .326.02.485.06L17 4m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"
      />
    </svg>
  );
}

/**
 * Thumbs feedback component for item-level feedback.
 */
function ThumbsFeedback({
  id,
  feedback,
  onFeedback,
}: {
  id: string;
  feedback?: "thumbs-up" | "thumbs-down";
  onFeedback: (id: string, value: "thumbs-up" | "thumbs-down" | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-1 ml-2">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onFeedback(id, feedback === "thumbs-up" ? undefined : "thumbs-up");
        }}
        className={`p-1 rounded transition-colors ${
          feedback === "thumbs-up"
            ? "text-green-600 bg-green-100"
            : "text-gray-400 hover:text-green-600 hover:bg-green-50"
        }`}
        title="Thumbs up"
      >
        <ThumbsUpIcon className="w-4 h-4" filled={feedback === "thumbs-up"} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onFeedback(id, feedback === "thumbs-down" ? undefined : "thumbs-down");
        }}
        className={`p-1 rounded transition-colors ${
          feedback === "thumbs-down"
            ? "text-red-600 bg-red-100"
            : "text-gray-400 hover:text-red-600 hover:bg-red-50"
        }`}
        title="Thumbs down"
      >
        <ThumbsDownIcon className="w-4 h-4" filled={feedback === "thumbs-down"} />
      </button>
    </div>
  );
}

/**
 * Parsed expando structure.
 */
interface Expando {
  id?: string;
  title: string;
  text: string;
}

/**
 * Parsed query structure.
 */
interface Query {
  id?: string;
  prompt: string;
  text?: string;
}

/**
 * Parsed excerpt structure.
 */
interface Excerpt {
  source: string;
  link?: string;
  text: string;
}

/**
 * Parsed section structure.
 */
interface Section {
  id?: string;
  heading?: string;
  link?: string;
  via?: string;
  text?: string;
  expandos: Expando[];
  queries: Query[];
  excerpts: Excerpt[];
}

/**
 * Parsed source reference.
 */
interface SourceRef {
  path: string;
  title: string;
  usage?: "primary" | "supporting" | "mentioned";
}

/**
 * Parsed news brief for the view.
 */
export interface NewsBriefData {
  title: string;
  date: string;
  byline: string;
  content: {
    format: "markdown";
    text: string;
    sections: Section[];
    expandos: Expando[];
    queries: Query[];
    excerpts: Excerpt[];
  };
  sources: SourceRef[];
}

/**
 * Guide reaction from news-guide.
 */
export interface GuideReaction {
  id: string;
  sentiment: "positive" | "negative" | "neutral";
  text: string;
}

/**
 * Brief-specific reaction from curation.
 */
export interface BriefReaction {
  id: string;
  experimentRef?: string;
  text: string;
}

interface NewsBriefViewProps {
  brief: NewsBriefData;
  /** Called when user submits a comment (text) */
  onComment?: (targetId: string, comment: string) => void;
  /** Called when user submits a voice comment */
  onVoiceComment?: (targetId: string, audioBlob: Blob) => Promise<void>;
  /** Called when user responds to a query (text) */
  onQueryResponse?: (queryId: string, response: string) => void;
  /** Called when user responds to a query (voice) */
  onVoiceQueryResponse?: (queryId: string, audioBlob: Blob) => Promise<void>;
  /** Called when user clicks a source */
  onSourceClick?: (sourcePath: string) => void;
  /** Guide reactions for completion UI */
  guideReactions?: GuideReaction[];
  /** Brief-specific reactions from curation */
  briefReactions?: BriefReaction[];
  /** Called when user completes reading with feedback */
  onCompleteReading?: (data: {
    overallRating: "great" | "ok" | "meh";
    selectedReactions: Array<{ id: string; source: "guide" | "brief" }>;
    itemFeedback: Array<{ id: string; feedback: "thumbs-up" | "thumbs-down" }>;
  }) => Promise<void>;
}

/**
 * Compact voice recorder for inline use in feedback areas.
 * Auto-starts recording when mounted.
 */
function InlineVoiceRecorder({
  onComplete,
  onCancel,
}: {
  onComplete: (blob: Blob) => Promise<void>;
  onCancel: () => void;
}) {
  const handleComplete = useCallback(
    async (result: VoiceRecordingResult) => {
      await onComplete(result.blob);
    },
    [onComplete]
  );

  const { state, error, duration, startRecording, stopRecording, formatDuration } =
    useVoiceRecorder({ onComplete: handleComplete });

  // Auto-start recording when component mounts
  useEffect(() => {
    if (state === "idle") {
      startRecording();
    }
  }, [state, startRecording]);

  if (state === "uploading") {
    return (
      <div className="flex items-center gap-2 py-2">
        <UploadingIndicator />
      </div>
    );
  }

  if (state === "recording") {
    return (
      <div className="flex items-center gap-3 py-2">
        <RecordingIndicator />
        <span className="font-mono text-sm">{formatDuration(duration)}</span>
        <button
          onClick={stopRecording}
          className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 flex items-center gap-1"
        >
          <StopIcon className="w-4 h-4" />
          Stop
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-gray-600 text-sm hover:text-gray-800"
        >
          Cancel
        </button>
      </div>
    );
  }

  // Show error state or starting state
  return (
    <div className="flex items-center gap-2 py-2">
      {error ? (
        <>
          <span className="text-red-600 text-sm">{error}</span>
          <button onClick={onCancel} className="px-3 py-1 text-gray-600 text-sm hover:text-gray-800">
            Cancel
          </button>
        </>
      ) : (
        <span className="text-gray-500 text-sm">Starting recorder...</span>
      )}
    </div>
  );
}

/**
 * Expando component - collapsible content section.
 */
function ExpandoSection({
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
    <div className="my-4 border-l-4 border-blue-200 bg-blue-50 rounded-r-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-blue-100 transition-colors"
      >
        <div className="flex items-center">
          <span className="font-medium text-blue-800">{expando.title}</span>
          {expanded && expando.id && onFeedback && (
            <ThumbsFeedback id={expando.id} feedback={feedback} onFeedback={onFeedback} />
          )}
        </div>
        <span className="text-blue-600">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{expando.text}</ReactMarkdown>
          </div>
          {/* Comment affordance */}
          <div className="mt-4 pt-4 border-t border-blue-200">
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
                  placeholder="Your thoughts on this..."
                  className="w-full p-2 text-sm border rounded resize-none"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSubmitComment}
                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                  >
                    Comment
                  </button>
                  {onVoiceComment && (
                    <button
                      onClick={() => {
                        setShowComment(false);
                        setShowVoice(true);
                      }}
                      className="px-3 py-1 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 flex items-center gap-1"
                    >
                      <MicrophoneIcon className="w-4 h-4" />
                      Voice
                    </button>
                  )}
                  <button
                    onClick={() => setShowComment(false)}
                    className="px-3 py-1 text-gray-600 text-sm hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowComment(true)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + Add comment
                </button>
                {onVoiceComment && (
                  <button
                    onClick={() => setShowVoice(true)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <MicrophoneIcon className="w-4 h-4" />
                    Voice
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Query component - prompts for user input.
 */
function QueryPrompt({
  query,
  onResponse,
  onVoiceResponse,
}: {
  query: Query;
  onResponse?: (id: string, response: string) => void;
  onVoiceResponse?: (id: string, audioBlob: Blob) => Promise<void>;
}) {
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [showVoice, setShowVoice] = useState(false);

  const handleSubmit = () => {
    if (response.trim() && onResponse && query.id) {
      onResponse(query.id, response);
      setSubmitted(true);
    }
  };

  const handleVoiceComplete = async (blob: Blob) => {
    if (onVoiceResponse && query.id) {
      await onVoiceResponse(query.id, blob);
      setShowVoice(false);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="my-4 p-4 bg-green-50 border border-green-200 rounded-lg">
        <p className="text-green-800 text-sm">Got it, I'll keep that in mind.</p>
      </div>
    );
  }

  return (
    <div className="my-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <p className="font-medium text-amber-900 mb-2">{query.prompt}</p>
      {query.text && <p className="text-sm text-amber-700 mb-3">{query.text}</p>}
      {showVoice ? (
        <InlineVoiceRecorder
          onComplete={handleVoiceComplete}
          onCancel={() => setShowVoice(false)}
        />
      ) : (
        <div className="space-y-2">
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Your response..."
            className="w-full p-2 text-sm border border-amber-300 rounded resize-none bg-white"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={!response.trim()}
              className="px-4 py-2 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Submit
            </button>
            {onVoiceResponse && (
              <button
                onClick={() => setShowVoice(true)}
                className="px-4 py-2 border border-amber-300 text-amber-800 text-sm rounded hover:bg-amber-100 flex items-center gap-1"
              >
                <MicrophoneIcon className="w-4 h-4" />
                Voice Response
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Excerpt component - quoted text from source.
 * Uses a div instead of blockquote to avoid prose styling adding quotes.
 */
function ExcerptBlock({ excerpt }: { excerpt: Excerpt }) {
  return (
    <div className="my-2 pl-3 border-l-2 border-gray-300 text-gray-600 text-sm">
      <p>{excerpt.text}</p>
      <p className="mt-1 text-xs text-gray-500">
        — {excerpt.link ? (
          <a href={excerpt.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            {excerpt.source}
          </a>
        ) : excerpt.source}
      </p>
    </div>
  );
}

/**
 * Section component - major content division.
 */
function ContentSection({
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
  return (
    <div className="mb-8" data-section-id={section.id}>
      {section.heading && (
        <div className="flex items-center justify-between mb-2 pb-2 border-b">
          <div className="flex items-center">
            <h2 className="text-xl font-semibold text-gray-800">
              {section.link ? (
                <a href={section.link} target="_blank" rel="noopener noreferrer" className="hover:text-blue-700">
                  {section.heading}
                </a>
              ) : section.heading}
            </h2>
            {section.id && onItemFeedback && (
              <ThumbsFeedback
                id={section.id}
                feedback={itemFeedback?.get(section.id)}
                onFeedback={onItemFeedback}
              />
            )}
          </div>
          {section.via && (
            <span className="text-xs text-gray-400 ml-4">
              via {section.via}
            </span>
          )}
        </div>
      )}
      {section.text && (
        <div className="prose prose-sm max-w-none mb-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.text}</ReactMarkdown>
        </div>
      )}
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
    </div>
  );
}

/**
 * Source list component.
 */
function SourceList({
  sources,
  onSourceClick,
}: {
  sources: SourceRef[];
  onSourceClick?: (path: string) => void;
}) {
  if (sources.length === 0) return null;

  const grouped = {
    primary: sources.filter((s) => s.usage === "primary"),
    supporting: sources.filter((s) => s.usage === "supporting"),
    mentioned: sources.filter((s) => s.usage === "mentioned" || !s.usage),
  };

  return (
    <div className="mt-8 pt-6 border-t border-gray-200">
      <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
        Sources
      </h3>
      <div className="space-y-4">
        {grouped.primary.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Primary</p>
            <ul className="space-y-1">
              {grouped.primary.map((source, i) => (
                <li key={i}>
                  <button
                    onClick={() => onSourceClick?.(source.path)}
                    className="text-blue-600 hover:text-blue-800 hover:underline text-sm text-left"
                  >
                    {source.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {grouped.supporting.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Supporting</p>
            <ul className="space-y-1">
              {grouped.supporting.map((source, i) => (
                <li key={i}>
                  <button
                    onClick={() => onSourceClick?.(source.path)}
                    className="text-blue-600 hover:text-blue-800 hover:underline text-sm text-left"
                  >
                    {source.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {grouped.mentioned.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Also referenced</p>
            <ul className="space-y-1">
              {grouped.mentioned.map((source, i) => (
                <li key={i}>
                  <button
                    onClick={() => onSourceClick?.(source.path)}
                    className="text-gray-600 hover:text-gray-800 hover:underline text-sm text-left"
                  >
                    {source.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Reading completion feedback component.
 */
function ReadingFeedback({
  guideReactions,
  briefReactions,
  onComplete,
  onShowComment,
  onShowVoice,
}: {
  guideReactions: GuideReaction[];
  briefReactions: BriefReaction[];
  onComplete: (rating: "great" | "ok" | "meh", selectedReactions: Array<{ id: string; source: "guide" | "brief" }>) => void;
  onShowComment: () => void;
  onShowVoice?: () => void;
}) {
  const [selectedRating, setSelectedRating] = useState<"great" | "ok" | "meh" | null>(null);
  const [selectedReactions, setSelectedReactions] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggleReaction = (id: string) => {
    setSelectedReactions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!selectedRating) return;
    setSubmitting(true);

    // Build the selected reactions array with source info
    const reactions: Array<{ id: string; source: "guide" | "brief" }> = [];
    for (const id of selectedReactions) {
      if (guideReactions.some((r) => r.id === id)) {
        reactions.push({ id, source: "guide" });
      } else if (briefReactions.some((r) => r.id === id)) {
        reactions.push({ id, source: "brief" });
      }
    }

    onComplete(selectedRating, reactions);
  };

  return (
    <div className="space-y-4">
      {/* Overall rating */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">How was this brief?</p>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedRating("great")}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              selectedRating === "great"
                ? "bg-green-100 border-green-500 text-green-800"
                : "border-gray-300 hover:bg-gray-50"
            }`}
          >
            Great
          </button>
          <button
            onClick={() => setSelectedRating("ok")}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              selectedRating === "ok"
                ? "bg-blue-100 border-blue-500 text-blue-800"
                : "border-gray-300 hover:bg-gray-50"
            }`}
          >
            OK
          </button>
          <button
            onClick={() => setSelectedRating("meh")}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              selectedRating === "meh"
                ? "bg-amber-100 border-amber-500 text-amber-800"
                : "border-gray-300 hover:bg-gray-50"
            }`}
          >
            Meh
          </button>
        </div>
      </div>

      {/* Reactions */}
      {(guideReactions.length > 0 || briefReactions.length > 0) && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Anything stand out? (optional)</p>
          <div className="flex flex-wrap gap-2">
            {guideReactions.map((reaction) => (
              <button
                key={reaction.id}
                onClick={() => toggleReaction(reaction.id)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selectedReactions.has(reaction.id)
                    ? reaction.sentiment === "negative"
                      ? "bg-red-100 border-red-400 text-red-800"
                      : reaction.sentiment === "positive"
                        ? "bg-green-100 border-green-400 text-green-800"
                        : "bg-blue-100 border-blue-400 text-blue-800"
                    : "border-gray-300 hover:bg-gray-50"
                }`}
              >
                {reaction.text}
              </button>
            ))}
            {briefReactions.map((reaction) => (
              <button
                key={reaction.id}
                onClick={() => toggleReaction(reaction.id)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selectedReactions.has(reaction.id)
                    ? "bg-purple-100 border-purple-400 text-purple-800"
                    : "border-gray-300 hover:bg-gray-50"
                }`}
              >
                {reaction.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Submit and additional options */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSubmit}
          disabled={!selectedRating || submitting}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Saving..." : "Done Reading"}
        </button>
        <span className="text-gray-400">or</span>
        <button
          onClick={onShowComment}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Add a comment
        </button>
        {onShowVoice && (
          <button
            onClick={onShowVoice}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            <MicrophoneIcon className="w-4 h-4" />
            Voice
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Main news brief view component.
 */
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
        // Convert itemFeedback map to array
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
        {/* Top-level markdown content */}
        {brief.content.text && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.content.text}</ReactMarkdown>
        )}

        {/* Sections */}
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

        {/* Top-level excerpts */}
        {brief.content.excerpts.map((excerpt, i) => (
          <ExcerptBlock key={i} excerpt={excerpt} />
        ))}

        {/* Top-level expandos */}
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

        {/* Top-level queries */}
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

export default NewsBriefView;
