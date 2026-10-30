/**
 * MarkdownCardView — default viewer for Phase 2 (YAML frontmatter + markdown
 * body) cards.
 *
 * The fields the front shows (`splitCardFields`) render as a key/value table
 * at the top level; the rest are in Properties. Scalar fields
 * occupy a single row; long-string fields take a value cell that wraps;
 * arrays and objects render recursively inside the value cell.
 *
 * Below the table, `CardBody` renders the quotes line, attached comments, and
 * the markdown body.
 *
 * An embed (a card shown inline in chat) has no header, so it draws the title
 * and the type's summary line itself, then the body, then the fields: an
 * answer to "show me X" reads prose first (docs/implemented-plans/place-shows-cards.md,
 * Track B). The field that gave the title (`title:`, else `name:`) is not
 * repeated in the field block.
 */

import type { ReactNode } from "react";
import { Text } from "../ui/Text";
import { FrontmatterFields } from "./FrontmatterFields";
import { cardTitle } from "../../lib/card-title";
import { withoutHeaderName } from "../../lib/readable-fields";
import { CardBody } from "./CardBody";
import { cardTypeMarkdown } from "./type-markdown";
import { bodyHeadingField, bodyHeadingTitle, isCardBodyEmpty, splitCardFields } from "../../lib/card-field-faces";
import type { FileData, RendererProps } from "../../file-type-registry";

/** The embed's own heading: the card's title (`bodyHeadingTitle`) and the type's summary line. Null when it has neither. */
function embedHeading({ title, detail }: { title: string | undefined; detail: string | undefined }): ReactNode {
  const shownTitle = title !== undefined && title.trim() !== "" ? title : undefined;
  if (shownTitle === undefined && detail === undefined) return null;
  return (
    <div className="mb-3" data-card-section="heading">
      {shownTitle === undefined ? null : <Text as="div" material weight="semibold">{shownTitle}</Text>}
      {detail === undefined ? null : <Text as="div" size="sm" tone="subtle" material truncate title={detail}>{detail}</Text>}
    </div>
  );
}

/** The fields the front shows; in an embed, without the field `EmbedHeading` draws as the title. */
function frontFields(data: FileData, { bodyEmpty, mode }: { bodyEmpty: boolean; mode: RendererProps["mode"] }): Record<string, unknown> {
  if (data.frontmatter === undefined) return {};
  const { front } = splitCardFields(data.frontmatter, { hasBodyField: data.schema?.hasBodyField ?? null, bodyEmpty, mode });
  if (mode !== "embed") return front;
  const headingField = bodyHeadingField(data.frontmatter);
  return Object.fromEntries(Object.entries(front).filter(([key]) => key !== headingField));
}

export function MarkdownCardView(props: RendererProps & { hideEmptyBody?: boolean }) {
  const { data, onNavigate, mode } = props;
  const embed = mode === "embed";
  const title = bodyHeadingTitle(data.frontmatter);
  const front = withoutHeaderName(frontFields(data, { bodyEmpty: isCardBodyEmpty(data.body, title), mode }), cardTitle(data));
  const showsFields = Object.keys(front).length > 0;
  const heading = embed ? embedHeading({ title, detail: data.detail }) : null;
  // With fields or a heading on the front, the card is not empty: no "No body content".
  const hideEmptyBody = (props.hideEmptyBody ?? false) || showsFields || heading !== null;
  const fields = showsFields ? (
    <div className={embed ? "mt-4 pt-3 border-t border-warm-200" : "mb-4 pb-3 border-b border-warm-200"} data-card-section="frontmatter">
      <FrontmatterFields fields={front} onNavigate={onNavigate} basePath={data.path} />
    </div>
  ) : null;

  return (
    <div className="bbx-card-content">
      {embed ? heading : fields}

      <CardBody
        data={data}
        title={title}
        onNavigate={onNavigate}
        hideEmptyBody={hideEmptyBody}
        markdown={cardTypeMarkdown(data.type)}
      />

      {embed ? fields : null}
    </div>
  );
}
