/**
 * CalendarView — the front of a calendar card (`schemas/calendar.tsx`).
 *
 * A calendar's content is its coming events, so they lead: the next 30 days
 * from the card's attach folder, grouped by day, each title opening its
 * `.ics` file. Above them, one line when the calendar is read-only in Google
 * or no longer pulled. Files that did not parse are named above the list, so
 * "No events" is only said when every file was read. The body (the person's
 * notes) follows through the shared `CardBody`.
 */

import { trpc } from "../../lib/trpc/client";
import { Text } from "../ui/Text";
import { Notice } from "../ui/Notice";
import { InlineAction } from "../ui/InlineAction";
import { StatusMessage } from "../ui/StatusMessage";
import { CardBody } from "../MarkdownCardView/CardBody";
import { bodyHeadingTitle } from "../../lib/card-field-faces";
import { isRecord } from "@shared/is-record";
import type { RendererProps } from "../../file-type-registry";
import type { ReactNode } from "react";

const DAYS_SHOWN = 30;

interface Window {
  /** The first day shown and the day `DAYS_SHOWN` days on, where the window ends. */
  first: Temporal.PlainDate;
  last: Temporal.PlainDate;
  /** The start of each of those days in the viewer's zone, for the query. */
  from: Temporal.Instant;
  to: Temporal.Instant;
  timeZone: string;
}

/** Today's start through `DAYS_SHOWN` days on, in `now`'s zone (the viewer's). */
export function upcomingWindow(now: Temporal.ZonedDateTime): Window {
  const first = now.toPlainDate();
  const last = first.add({ days: DAYS_SHOWN });
  const startOf = (day: Temporal.PlainDate) => day.toZonedDateTime(now.timeZoneId).toInstant();
  return { first, last, from: startOf(first), to: startOf(last), timeZone: now.timeZoneId };
}

/** `access` and `syncing` from the card's `google-calendar:` block, when present and well-formed. */
function calendarFacts(frontmatter: Record<string, unknown>): { access: string | undefined; syncing: boolean } {
  const block = frontmatter["google-calendar"];
  if (!isRecord(block)) return { access: undefined, syncing: true };
  return {
    access: typeof block["access"] === "string" ? block["access"] : undefined,
    syncing: block["syncing"] !== false,
  };
}

const dayLabel = (day: Temporal.PlainDate): string => day.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeLabel = (start: string): string => Temporal.Instant.from(start).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });

interface ListedEvent {
  start: string;
  allDay: boolean;
  summary: string;
  location?: string | undefined;
  file: string;
}

/**
 * The day an event starts on. An all-day `2026-11-05` is that calendar day in
 * any zone; a timed event's start is an instant, placed in `timeZone`.
 */
function dayOf(event: ListedEvent, timeZone: string): Temporal.PlainDate {
  if (event.allDay) return Temporal.PlainDate.from(event.start);
  return Temporal.Instant.from(event.start).toZonedDateTimeISO(timeZone).toPlainDate();
}

/** Events grouped under their day's label, in order. Grouped by the day itself, so two days never share a label's group. */
export function byDay(events: readonly ListedEvent[], timeZone: string): Array<[string, ListedEvent[]]> {
  const groups = new Map<string, { day: Temporal.PlainDate; events: ListedEvent[] }>();
  for (const event of events) {
    const day = dayOf(event, timeZone);
    const group = groups.get(day.toString());
    if (group) group.events.push(event);
    else groups.set(day.toString(), { day, events: [event] });
  }
  return [...groups.values()].map(({ day, events: list }) => [dayLabel(day), list]);
}

function StatusLines({ access, syncing }: { access: string | undefined; syncing: boolean }): ReactNode {
  const readOnly = access === "reader" || access === "freeBusyReader";
  if (!readOnly && syncing) return null;
  return (
    <div className="mb-3 flex flex-col gap-1">
      {readOnly ? <Text material tone="muted" size="sm">Read-only in Google: Google does not accept changes from here.</Text> : null}
      {syncing ? null : <Text material tone="muted" size="sm">Not pulled from Google: changes made there no longer arrive here.</Text>}
    </div>
  );
}

function EventList({ path, window, onNavigate }: { path: string; window: Window } & Pick<RendererProps, "onNavigate">): ReactNode {
  const query = trpc.calendar.cardEvents.useQuery({ path, from: window.from.toString(), to: window.to.toString() });
  if (query.isLoading) return <StatusMessage>Loading events…</StatusMessage>;
  if (query.error) return <Notice tone="error">Could not read this calendar's events: {query.error.message}</Notice>;
  const { events, unreadable } = query.data ?? { events: [], unreadable: [] };
  const open = (file: string) => () => onNavigate({ path: file, viewer: null, params: {}, viewState: null });
  return (
    <div className="mb-4 flex flex-col gap-3" data-card-section="calendar-events">
      {unreadable.length > 0 ? (
        <Notice tone="warning">
          {unreadable.length === 1 ? "One event file could not be read" : `${String(unreadable.length)} event files could not be read`}:{" "}
          {unreadable.map((file) => file.split("/").pop()).join(", ")}
        </Notice>
      ) : null}
      {events.length === 0 && unreadable.length === 0 ? (
        <Text material tone="muted">No events between {dayLabel(window.first)} and {dayLabel(window.last)}.</Text>
      ) : null}
      {byDay(events, window.timeZone).map(([day, list]) => (
        <section key={day} className="flex flex-col gap-1">
          <Text material weight="semibold" size="sm">{day}</Text>
          <ul className="flex flex-col gap-0.5">
            {list.map((event) => (
              <li key={`${event.file}@${event.start}`} className="flex flex-wrap items-baseline gap-x-2">
                <Text material tone="muted" size="sm" className="w-20 shrink-0">{event.allDay ? "All day" : timeLabel(event.start)}</Text>
                <InlineAction intent="quiet" onClick={open(event.file)} title={event.file}>{event.summary}</InlineAction>
                {event.location === undefined ? null : <Text material tone="muted" size="sm">{event.location}</Text>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function CalendarView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter ?? {};
  const facts = calendarFacts(frontmatter);
  return (
    <div className="bbx-card-content">
      <StatusLines access={facts.access} syncing={facts.syncing} />
      <EventList path={data.path} window={upcomingWindow(Temporal.Now.zonedDateTimeISO())} onNavigate={onNavigate} />
      <CardBody data={data} title={bodyHeadingTitle(frontmatter)} onNavigate={onNavigate} hideEmptyBody />
    </div>
  );
}
