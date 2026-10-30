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

import { Markdown } from "../Markdown/body";
import { AttachedComments } from "../AttachedComments";
import { CARD_EMBED_COMPONENTS } from "../FigureEmbed";
import { shownCardBody } from "../../lib/card-field-faces";
import { extractQuoteSpeakers, isPersonRef, speakerDisplay } from "../../lib/selection/quote-extract";
import type { FileData } from "../../file-type-registry";
import { useMemo, type ReactNode } from "react";
import { CompositionCardContext, useComposeSession, type CompositionCard } from "./Composition";
import type { CardTypeMarkdown } from "./type-markdown";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";
import { StatusMessage } from "../ui/StatusMessage";

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
    <div className="text-xs text-warm-700 mb-3 bbx-quote-speakers">
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
 * `title` is the card's displayed title (`bodyHeadingTitle`). A body opening
 * with the same `# heading` would show it twice, so that line is blanked
 * (`shownCardBody`). `hideEmptyBody` drops the "No body content" line, which a
 * front that shows fields above the body passes. `markdown` is the card type's
 * scoped tags and components (`cardTypeMarkdown`).
 */
export function CardBody({
  data,
  title,
  onNavigate,
  hideEmptyBody,
  markdown,
}: {
  data: FileData;
  title: string | undefined;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  hideEmptyBody: boolean;
  markdown?: CardTypeMarkdown | undefined;
}): ReactNode {
  const body = shownCardBody(data.body, title);
  const composeEditor = markdown?.composeEditor ?? null;
  // Owned here, above the parsed body, so a remounted composition block keeps its editor.
  const compose = useComposeSession({ body: data.body ?? "", cardPath: data.path, composeEditor });
  const composition = useMemo<CompositionCard>(
    () => ({ body: data.body ?? "", cardPath: data.path, composeEditor, ...compose.session }),
    [data.body, data.path, composeEditor, compose.session],
  );
  const speakers = body === null ? [] : extractQuoteSpeakers(body);

  return (
    <>
      <QuoteSpeakersLine speakers={speakers} onNavigate={onNavigate} />

      <AttachedComments cardPath={data.path} frontmatter={data.frontmatter} />

      {/* Where the editor shows when the body lost its composition (`useComposeSession`). */}
      {compose.fallback}
      {body !== null ? (
        <div data-card-section="body">
          <CompositionCardContext.Provider value={composition}>
            <Markdown
              prose="block"
              outline
              onNavigate={onNavigate}
              basePath={data.path}
              // Inline figure embeds: `![](…figure.card)` renders the figure in place.
              components={markdown?.components ?? CARD_EMBED_COMPONENTS}
              {...(markdown === undefined ? {} : { tags: markdown.tags })}
              {...(data.bodyLineOffset === undefined ? {} : { card: { path: data.path, bodyLineOffset: data.bodyLineOffset } })}
            >
              {body}
            </Markdown>
          </CompositionCardContext.Provider>
        </div>
      ) : hideEmptyBody ? null : (
        <StatusMessage className="p-4">No body content</StatusMessage>
      )}
      {compose.editor}
    </>
  );
}
