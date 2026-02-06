/**
 * ContentSection - Major content division with heading, text, expandos, queries, excerpts.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Section } from "./types";
import { ThumbsFeedback } from "./ThumbsFeedback";
import { ExpandoSection } from "./ExpandoSection";
import { QueryPrompt } from "./QueryPrompt";
import { ExcerptBlock } from "./ExcerptBlock";

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
