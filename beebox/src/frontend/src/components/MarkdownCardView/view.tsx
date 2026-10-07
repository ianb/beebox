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
 */

import { FrontmatterFields } from "./FrontmatterFields";
import { CardBody } from "./CardBody";
import { splitCardFields } from "../../lib/card-field-faces";
import type { RendererProps } from "../../file-type-registry";

export function MarkdownCardView(props: RendererProps & { hideEmptyBody?: boolean }) {
  const { data, onNavigate, mode } = props;
  const hideEmptyBody = props.hideEmptyBody ?? false;
  const front = data.frontmatter === undefined
    ? undefined
    : splitCardFields(data.frontmatter, { hasBodyField: data.schema?.hasBodyField ?? null, mode }).front;
  const title = data.frontmatter?.["title"];

  return (
    <div className="bbx-card-content">
      {front !== undefined && Object.keys(front).length > 0 ? (
        <div className="mb-4 pb-3 border-b border-warm-200" data-card-section="frontmatter">
          <FrontmatterFields fields={front} onNavigate={onNavigate} basePath={data.path} />
        </div>
      ) : null}

      <CardBody
        data={data}
        title={typeof title === "string" ? title : undefined}
        onNavigate={onNavigate}
        hideEmptyBody={hideEmptyBody}
      />
    </div>
  );
}
