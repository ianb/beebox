/**
 * MarkdownCardView — default viewer for Phase 2 (YAML frontmatter + markdown
 * body) cards.
 *
 * The fields the front shows (`splitCardFields`) render as a key/value table
 * at the top level; the rest are in Properties. Scalar fields
 * occupy a single row; long-string fields take a value cell that wraps;
 * arrays and objects render recursively inside the value cell.
 *
 * The markdown body is rendered via the shared `<Markdown>` component, so
 * view:/relative links resolve the same way as for `.md` files.
 */

import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { Markdown } from "../Markdown/body";
import { AttachedComments } from "../AttachedComments";
import { makeEmbedComponents } from "../FigureEmbed";
import { FrontmatterFields } from "./FrontmatterFields";
import { splitCardFields } from "../../lib/card-field-faces";
import { extractQuoteSpeakers, isPersonRef, speakerDisplay } from "../../lib/selection/quote-extract";
import type { RendererProps } from "../../file-type-registry";
import type { ReactNode } from "react";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";

/**
 * Navigation context for the frontmatter tree, so deeply-nested `{ ref: … }`
 * values can resolve relative paths and navigate without threading
 * `onNavigate`/`basePath` through every recursive `ValueView`/`FieldsTable`.
 */
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
    <div className="text-xs text-warm-500 mb-3 bbx-quote-speakers">
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
                viewState: null,
              };
              onNavigate(target, { label: display });
            }}
            className="bbx-theme-link cursor-pointer"
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

export function MarkdownCardView(props: RendererProps & { hideEmptyBody?: boolean }) {
  const { data, onNavigate, mode } = props;
  const hideEmptyBody = props.hideEmptyBody ?? false;
  const front = data.frontmatter === undefined
    ? undefined
    : splitCardFields(data.frontmatter, { hasBodyField: data.schema?.hasBodyField ?? null, mode }).front;
  const body = data.body;
  const speakers = body === undefined ? [] : extractQuoteSpeakers(body);
  const { boxSlug } = useParams({ strict: false });
  // Inline figure embeds: `![](view:…figure.card)` renders the figure in place.
  const components = useMemo(
    () => makeEmbedComponents({ onNavigate, basePath: data.path, boxSlug, onJumpToQuote: undefined }),
    [onNavigate, data.path, boxSlug],
  );

  return (
    <div className="bbx-card-content">
      {front !== undefined && Object.keys(front).length > 0 ? (
        <div className="mb-4 pb-3 border-b border-warm-200" data-card-section="frontmatter">
          <FrontmatterFields fields={front} onNavigate={onNavigate} basePath={data.path} />
        </div>
      ) : null}

      <QuoteSpeakersLine speakers={speakers} onNavigate={onNavigate} />

      <AttachedComments cardPath={data.path} frontmatter={data.frontmatter} />

      {body !== undefined && body.trim() !== "" ? (
        <div data-card-section="body">
          <Markdown
            prose="block"
            onNavigate={onNavigate}
            basePath={data.path}
            components={components}
            {...(data.bodyLineOffset === undefined ? {} : { card: { path: data.path, bodyLineOffset: data.bodyLineOffset } })}
          >
            {body}
          </Markdown>
        </div>
      ) : hideEmptyBody ? null : (
        <div className="text-sm text-warm-500 italic">No body content</div>
      )}
    </div>
  );
}
