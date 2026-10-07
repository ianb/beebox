/**
 * CardBody — the reading part of a frontmatter card's front below its fields:
 * the "Direct quotes from" line, attached comments, and the markdown body.
 * Shared by `MarkdownCardView` and type fronts (e.g. `PersonView`) so every
 * front renders its body the same way.
 *
 * The body renders through the shared `<Markdown>` component, so view:/relative
 * links resolve the same way as for `.md` files, inline figure embeds render in
 * place, and todo locators count from `bodyLineOffset`.
 */

import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { Markdown } from "../Markdown/body";
import { AttachedComments } from "../AttachedComments";
import { makeEmbedComponents } from "../FigureEmbed";
import { blankLeadingTitleHeading } from "@shared/leading-title-heading";
import { extractQuoteSpeakers, isPersonRef, speakerDisplay } from "../../lib/selection/quote-extract";
import type { FileData } from "../../file-type-registry";
import type { ReactNode } from "react";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";

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

/**
 * `title` is the card's displayed title. A body opening with the same
 * `# heading` would show it twice, so that line is blanked, not removed:
 * todo locators (counted from `bodyLineOffset`) keep their numbers.
 */
export function CardBody({
  data,
  title,
  onNavigate,
  hideEmptyBody,
}: {
  data: FileData;
  title: string | undefined;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  hideEmptyBody: boolean;
}): ReactNode {
  const body = data.body === undefined || title === undefined
    ? data.body
    : blankLeadingTitleHeading(data.body, title);
  const speakers = body === undefined ? [] : extractQuoteSpeakers(body);
  const { boxSlug } = useParams({ strict: false });
  // Inline figure embeds: `![](view:…figure.card)` renders the figure in place.
  const components = useMemo(
    () => makeEmbedComponents({ onNavigate, basePath: data.path, boxSlug, onJumpToQuote: undefined }),
    [onNavigate, data.path, boxSlug],
  );

  return (
    <>
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
    </>
  );
}
