/**
 * NewsEditionView - Renders a news edition with interactive elements.
 *
 * Supports:
 * - Markdown content rendering
 * - Expandable sections (expandos)
 * - Query prompts for user input
 * - Paragraph-level comment affordances
 * - Source references
 */

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
 * Parsed section structure.
 */
interface Section {
  id?: string;
  heading?: string;
  text?: string;
  expandos: Expando[];
  queries: Query[];
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
 * Parsed news edition for the view.
 */
export interface NewsEditionData {
  status: string;
  title: string;
  date: string;
  byline: string;
  content: {
    format: "markdown";
    text: string;
    sections: Section[];
    expandos: Expando[];
    queries: Query[];
  };
  sources: SourceRef[];
}

interface NewsEditionViewProps {
  edition: NewsEditionData;
  /** Called when user submits a comment */
  onComment?: (targetId: string, comment: string) => void;
  /** Called when user responds to a query */
  onQueryResponse?: (queryId: string, response: string) => void;
  /** Called when user clicks a source */
  onSourceClick?: (sourcePath: string) => void;
}

/**
 * Expando component - collapsible content section.
 */
function ExpandoSection({ expando, onComment }: { expando: Expando; onComment?: (id: string, comment: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");

  const handleSubmitComment = () => {
    if (comment.trim() && onComment && expando.id) {
      onComment(expando.id, comment);
      setComment("");
      setShowComment(false);
    }
  };

  return (
    <div className="my-4 border-l-4 border-blue-200 bg-blue-50 rounded-r-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-blue-100 transition-colors"
      >
        <span className="font-medium text-blue-800">{expando.title}</span>
        <span className="text-blue-600">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{expando.text}</ReactMarkdown>
          </div>
          {/* Comment affordance */}
          <div className="mt-4 pt-4 border-t border-blue-200">
            {showComment ? (
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
                  <button
                    onClick={() => setShowComment(false)}
                    className="px-3 py-1 text-gray-600 text-sm hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowComment(true)}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                + Add comment
              </button>
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
function QueryPrompt({ query, onResponse }: { query: Query; onResponse?: (id: string, response: string) => void }) {
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (response.trim() && onResponse && query.id) {
      onResponse(query.id, response);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="my-4 p-4 bg-green-50 border border-green-200 rounded-lg">
        <p className="text-green-800 text-sm">Thanks for your response!</p>
      </div>
    );
  }

  return (
    <div className="my-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <p className="font-medium text-amber-900 mb-2">{query.prompt}</p>
      {query.text && (
        <p className="text-sm text-amber-700 mb-3">{query.text}</p>
      )}
      <div className="space-y-2">
        <textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Your response..."
          className="w-full p-2 text-sm border border-amber-300 rounded resize-none bg-white"
          rows={3}
        />
        <button
          onClick={handleSubmit}
          disabled={!response.trim()}
          className="px-4 py-2 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

/**
 * Section component - major content division.
 */
function ContentSection({ section, onComment, onQueryResponse }: {
  section: Section;
  onComment?: (id: string, comment: string) => void;
  onQueryResponse?: (id: string, response: string) => void;
}) {
  return (
    <div className="mb-8" data-section-id={section.id}>
      {section.heading && (
        <h2 className="text-xl font-semibold text-gray-800 mb-4 pb-2 border-b">
          {section.heading}
        </h2>
      )}
      {section.text && (
        <div className="prose prose-sm max-w-none mb-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.text}</ReactMarkdown>
        </div>
      )}
      {section.expandos.map((expando, i) => (
        <ExpandoSection key={expando.id ?? i} expando={expando} onComment={onComment} />
      ))}
      {section.queries.map((query, i) => (
        <QueryPrompt key={query.id ?? i} query={query} onResponse={onQueryResponse} />
      ))}
    </div>
  );
}

/**
 * Source list component.
 */
function SourceList({ sources, onSourceClick }: { sources: SourceRef[]; onSourceClick?: (path: string) => void }) {
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
 * Main news edition view component.
 */
export function NewsEditionView({
  edition,
  onComment,
  onQueryResponse,
  onSourceClick,
}: NewsEditionViewProps) {
  const [showGlobalComment, setShowGlobalComment] = useState(false);
  const [globalComment, setGlobalComment] = useState("");

  const handleGlobalComment = useCallback(() => {
    if (globalComment.trim() && onComment) {
      onComment("global", globalComment);
      setGlobalComment("");
      setShowGlobalComment(false);
    }
  }, [globalComment, onComment]);

  return (
    <article className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <time className="text-sm text-gray-500 block mb-2">
          {new Date(edition.date).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          {edition.title}
        </h1>
        {edition.byline && (
          <p className="text-lg text-gray-600 italic">
            {edition.byline}
          </p>
        )}
        {edition.status === "draft" && (
          <span className="inline-block mt-2 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded">
            Draft
          </span>
        )}
      </header>

      {/* Main content */}
      <div className="prose prose-lg max-w-none mb-8">
        {/* Top-level markdown content */}
        {edition.content.text && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {edition.content.text}
          </ReactMarkdown>
        )}

        {/* Sections */}
        {edition.content.sections.map((section, i) => (
          <ContentSection
            key={section.id ?? i}
            section={section}
            onComment={onComment}
            onQueryResponse={onQueryResponse}
          />
        ))}

        {/* Top-level expandos */}
        {edition.content.expandos.map((expando, i) => (
          <ExpandoSection key={expando.id ?? i} expando={expando} onComment={onComment} />
        ))}

        {/* Top-level queries */}
        {edition.content.queries.map((query, i) => (
          <QueryPrompt key={query.id ?? i} query={query} onResponse={onQueryResponse} />
        ))}
      </div>

      {/* Sources */}
      <SourceList sources={edition.sources} onSourceClick={onSourceClick} />

      {/* Global feedback */}
      <div className="mt-8 pt-6 border-t border-gray-200">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          Feedback
        </h3>
        {showGlobalComment ? (
          <div className="space-y-3">
            <textarea
              value={globalComment}
              onChange={(e) => setGlobalComment(e.target.value)}
              placeholder="What did you think of this edition? What did you learn? What would you like to see more or less of?"
              className="w-full p-3 border rounded-lg resize-none"
              rows={4}
            />
            <div className="flex gap-2">
              <button
                onClick={handleGlobalComment}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Submit Feedback
              </button>
              <button
                onClick={() => setShowGlobalComment(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowGlobalComment(true)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            Share your thoughts on this edition
          </button>
        )}
      </div>
    </article>
  );
}

export default NewsEditionView;
