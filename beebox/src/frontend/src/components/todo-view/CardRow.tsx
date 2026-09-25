/**
 * One card's block in a `todo-view` list (`docs/plans/todo-collection.md`,
 * Track 4): the card itself as a header, what it amounts to, then its todos
 * under the headings they were written beneath.
 *
 * The header is a `FileEntry`, which is the whole point of Track 1's
 * `summarize`: a memo, an image, and a box-local card type each head their
 * block the way their own type says to, with the generic title/detail
 * fallback for one that says nothing. Keeping `FileEntry` also keeps its
 * peek — the boxholder's open question — because the alternative was a
 * hand-built link that would have had to re-implement the mark, the type
 * icon, and the type's list component to look the same.
 */

import { FileEntry } from "../ui/FileEntry";
import { Badge } from "../ui/Badge";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { bbxSource } from "../../lib/source-tag";
import { ItemTree } from "./ItemTree";
import { buildRowSections, progressOf, type TodoReduction, type TodoRow } from "../todo-view-card-logic";

/** What a card amounts to: what is open, what is finished, and the next date it carries. */
function RowReduction({ reduction }: { reduction: TodoReduction }) {
  return (
    <Row gap="xs" wrap align="baseline" className="flex-shrink-0">
      <Text size="xs" tone="muted">
        {reduction.open} open · {reduction.done} done
      </Text>
      {reduction.next === null ? null : (
        <Badge size="sm" tone="info" title="Next date on this card">next {reduction.next}</Badge>
      )}
    </Row>
  );
}

function SectionHead({ label, path, reduction }: { label: string; path: string[]; reduction: TodoReduction | null }) {
  const progress = reduction === null ? null : progressOf(reduction);
  return (
    <Row gap="xs" align="baseline">
      {/* The subhead shows the last segment; the full path is the tooltip, so
          a deep heading is identifiable without a line of breadcrumbs. */}
      <Text size="xs" tone="muted" uppercase weight="semibold" title={path.join(" › ")}>
        {label}
      </Text>
      {progress === null || progress.total === 0 ? null : (
        <Text size="xs" tone="muted">
          {progress.done} of {progress.total}
        </Text>
      )}
    </Row>
  );
}

export function CardRow({ row }: { row: TodoRow }) {
  const sections = buildRowSections(row);
  return (
    <Stack gap="sm" {...bbxSource("card", row.card.path)}>
      <Row gap="sm" align="start" justify="between" wrap={false}>
        <FileEntry summary={row.card} className="flex-1 min-w-0" />
        <Stack gap="none" align="end" className="flex-shrink-0 pt-1.5">
          <RowReduction reduction={row.reduction} />
          {row.via === "reference" ? (
            <Text size="xs" tone="muted" italic title="This card is outside the scope; its todos link into it">
              refers here
            </Text>
          ) : null}
        </Stack>
      </Row>
      <Stack gap="sm" className="pl-2">
        {sections.map((section) => (
          <Stack key={section.path.join(" › ")} gap="xs">
            {section.label === null ? null : (
              <SectionHead label={section.label} path={section.path} reduction={section.reduction} />
            )}
            <ItemTree nodes={section.nodes} />
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
