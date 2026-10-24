/**
 * The "By date" tab of a `todo-view` list
 * (`docs/implemented-plans/todo-collection.md`, Track 4).
 *
 * Every open dated todo, in date order, out of whatever card it was written
 * in. Each line says whether its date is a deadline or a start, because
 * "later · Monday" and "due Monday" are not the same news. It used to be a
 * strip above the card blocks, which listed each dated todo twice
 * (`issues/closed/bugs/2026-10-22-todo-page-lists-each-dated-todo-twice.md`).
 *
 * When nothing is dated it says so.
 */

import { Badge } from "../ui/Badge";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextLink } from "../ui/TextLink";
import { FriendlyDate } from "../ui/FriendlyDate";
import { InlineAction } from "../ui/InlineAction";
import { href } from "../../lib/routing";
import { cardTarget, useOpenBeside } from "../chat/workspace/use-open-beside/hook";
import type { DatedTodo } from "../todo-view-card-logic";
import { dueWord, localIsoDate, startPrefix } from "../todo/item-logic";
import { boxNow } from "../../lib/box-clock";

function DatedLine({ dated, boxSlug }: { dated: DatedTodo; boxSlug: string | undefined }) {
  const cardHref = boxSlug === undefined ? undefined : href(`/${boxSlug}/browse/${dated.cardPath}`);
  // In a workspace pane the card opens in the other pane (`docs/implemented-plans/todos-ui.md`, Track 5).
  const openBeside = useOpenBeside();
  const name = <Text material size="xs" tone="muted">{dated.cardTitle}</Text>;
  const word = dated.kind === "due" ? dueWord(dated.item.plateState) : startPrefix({ plateState: dated.item.plateState, startIso: dated.date, todayIso: localIsoDate(new Date(boxNow())) });
  const title = word === "overdue" ? "Overdue" : word === "due" ? "Due" : word === "since" ? "Started on this day" : "Starts on this day";
  // Overdue is the warning; a deadline not yet reached reads like the card
  // rows' plain "due" chip, and a start like their start chip.
  const tone = word === "overdue" ? "warning" : dated.kind === "due" ? "neutral" : "info";
  // One line per item: the text truncates (full text on hover) so the card
  // name stays on its own item's line and never reads as the next item's heading.
  return (
    <Row gap="sm" align="baseline">
      <Badge size="sm" tone={tone} title={title} className="shrink-0">
        {word} <FriendlyDate iso={dated.date} mode="date" />
      </Badge>
      <Text material size="sm" truncate title={dated.item.text} className="min-w-0 flex-1">{dated.item.text}</Text>
      <span className="min-w-0 max-w-[40%] shrink-0 truncate">
        {openBeside !== null ? (
          <InlineAction material intent="quiet" onClick={() => openBeside(cardTarget(dated.cardPath))}>{name}</InlineAction>
        ) : cardHref === undefined ? name : (
          <TextLink material to={cardHref} tone="subtle">{name}</TextLink>
        )}
      </span>
    </Row>
  );
}

export function DatedList({ dated, boxSlug }: { dated: DatedTodo[]; boxSlug: string | undefined }) {
  if (dated.length === 0) return <Text material as="div" tone="subtle">No todos with a date.</Text>;
  return (
    <Stack gap="xs">
      {dated.map((entry) => (
        <DatedLine key={entry.key} dated={entry} boxSlug={boxSlug} />
      ))}
    </Stack>
  );
}
