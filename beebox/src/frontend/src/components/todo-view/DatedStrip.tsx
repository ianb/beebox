/**
 * The dated strip at the top of a `todo-view` list
 * (`docs/plans/todo-collection.md`, Track 4).
 *
 * Most todos in a working box carry no date at all, so the few that do are
 * the ones a calendar-shaped reading is actually about. They come first, in
 * date order, out of whatever card they were written in — and the strip says
 * whether a date is a deadline or a start, because "starts Monday" and "due
 * Monday" are not the same news.
 *
 * It does not render when nothing is dated.
 */

import { Badge } from "../ui/Badge";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextLink } from "../ui/TextLink";
import { FriendlyDate } from "../ui/FriendlyDate";
import { href } from "../../lib/routing";
import type { DatedTodo } from "../todo-view-card-logic";

function DatedLine({ dated, boxSlug }: { dated: DatedTodo; boxSlug: string | undefined }) {
  const cardHref = boxSlug === undefined ? undefined : href(`/${boxSlug}/browse/${dated.cardPath}`);
  return (
    <Row gap="sm" wrap align="baseline">
      <Badge size="sm" tone={dated.kind === "due" ? "warning" : "info"} title={dated.kind === "due" ? "Due" : "Starts"}>
        {dated.kind === "due" ? "due" : "starts"} <FriendlyDate iso={dated.date} mode="date" />
      </Badge>
      <Text size="sm">{dated.item.text}</Text>
      {cardHref === undefined ? (
        <Text size="xs" tone="muted">{dated.cardTitle}</Text>
      ) : (
        <TextLink to={cardHref} tone="subtle">
          <Text size="xs" tone="muted">{dated.cardTitle}</Text>
        </TextLink>
      )}
    </Row>
  );
}

export function DatedStrip({ dated, boxSlug }: { dated: DatedTodo[]; boxSlug: string | undefined }) {
  if (dated.length === 0) return null;
  return (
    <Stack gap="xs">
      <Text size="xs" tone="muted" uppercase weight="semibold">Dated</Text>
      {dated.map((entry) => (
        <DatedLine key={entry.key} dated={entry} boxSlug={boxSlug} />
      ))}
    </Stack>
  );
}
