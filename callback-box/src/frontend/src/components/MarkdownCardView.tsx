/**
 * MarkdownCardView — default viewer for Phase 2 (YAML frontmatter + markdown
 * body) cards.
 *
 * Frontmatter renders as a key/value table at the top level. Scalar fields
 * occupy a single row; long-string fields take a value cell that wraps;
 * arrays and objects render recursively inside the value cell.
 *
 * The markdown body is rendered via the shared `<Markdown>` component, so
 * view:/relative links resolve the same way as for `.md` files.
 */

import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { Markdown } from "./Markdown";
import { makeFigureEmbedComponents } from "./FigureEmbed";
import { extractQuoteSpeakers, isPersonRef, speakerDisplay } from "../lib/quote-extract";
import type { RendererProps } from "../renderers";
import type { ReactNode } from "react";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

type Scalar = string | number | boolean | null;

function isScalar(v: unknown): v is Scalar {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function formatScalar(v: Scalar): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * Render an arbitrary value (the right-hand side of a key/value row, or the
 * content of a list item). Scalars render inline; objects render as a nested
 * key/value table; arrays render as a list.
 */
function ValueView({ value }: { value: unknown }): ReactNode {
  if (isScalar(value)) {
    return <span className="whitespace-pre-wrap break-words">{formatScalar(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-warm-500 italic">empty</span>;
    }
    const allScalar = value.every(isScalar);
    if (allScalar) {
      return (
        <ul className="list-disc list-inside space-y-0.5">
          {value.map((item, i) => (
            <li key={i}>{formatScalar(item as Scalar)}</li>
          ))}
        </ul>
      );
    }
    return (
      <ol className="list-decimal list-outside ml-5 space-y-2 marker:text-warm-400">
        {value.map((item, i) => (
          <li key={i}>
            <ValueView value={item} />
          </li>
        ))}
      </ol>
    );
  }
  if (value !== null && typeof value === "object") {
    return <FieldsTable fields={value as Record<string, unknown>} />;
  }
  return null;
}

/**
 * Two-column key/value table. The key column is right-aligned and sized to
 * content; the value column takes the remaining width.
 */
function FieldsTable({ fields }: { fields: Record<string, unknown> }) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm text-warm-800">
      {entries.map(([key, value]) => (
        <FieldRow key={key} name={key} value={value} />
      ))}
    </dl>
  );
}

function FieldRow({ name, value }: { name: string; value: unknown }) {
  return (
    <>
      <dt className="text-warm-500 text-right whitespace-nowrap">{name}</dt>
      <dd className="min-w-0">
        <ValueView value={value} />
      </dd>
    </>
  );
}

/**
 * Subtle "Direct quotes from: …" subtitle when the doc body contains one
 * or more `{% quote from="..." %}` tags. Person-ref speakers become links
 * to their person card via `onNavigate`; display-name speakers render as
 * plain text. Kept compact (single line, muted styling) so docs with
 * heavy quoting don't get a banner — the goal is to surface provenance,
 * not announce it.
 */
function QuoteSpeakersLine({
  speakers,
  onNavigate,
}: {
  speakers: string[];
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}): ReactNode {
  if (speakers.length === 0) return null;
  return (
    <div className="text-xs text-warm-500 mb-3">
      <span className="font-medium">Direct quotes from:</span>{" "}
      {speakers.map((speaker, i) => {
        const display = speakerDisplay(speaker);
        const node = isPersonRef(speaker) ? (
          <button
            key={speaker}
            type="button"
            onClick={() => {
              const target: ViewTarget = {
                path: speaker,
                viewer: null,
                params: {},
                zoom: false,
              };
              onNavigate(target, { label: display });
            }}
            className="text-warm-600 hover:text-warm-800 underline-offset-2 hover:underline cursor-pointer"
          >
            {display}
          </button>
        ) : (
          <span key={speaker}>{display}</span>
        );
        return (
          <span key={`${speaker}-wrap`}>
            {i > 0 ? ", " : ""}
            {node}
          </span>
        );
      })}
    </div>
  );
}

export function MarkdownCardView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter;
  const body = data.body;
  const speakers = body === undefined ? [] : extractQuoteSpeakers(body);
  const { boxSlug } = useParams({ strict: false });
  // Inline figure embeds: `![](view:…figure.card)` renders the figure in place.
  const components = useMemo(
    () => makeFigureEmbedComponents({ onNavigate, basePath: data.path, boxSlug, onJumpToQuote: undefined }),
    [onNavigate, data.path, boxSlug],
  );

  return (
    <div className="p-4 max-w-3xl">
      {frontmatter !== undefined && Object.keys(frontmatter).length > 0 ? (
        <div className="mb-4 pb-3 border-b border-warm-200" data-card-section="frontmatter">
          <FieldsTable fields={frontmatter} />
        </div>
      ) : null}

      <QuoteSpeakersLine speakers={speakers} onNavigate={onNavigate} />

      {body !== undefined && body.trim() !== "" ? (
        <div data-card-section="body">
          <Markdown prose="block" onNavigate={onNavigate} basePath={data.path} components={components}>
            {body}
          </Markdown>
        </div>
      ) : (
        <div className="text-sm text-warm-500 italic">No body content</div>
      )}
    </div>
  );
}
