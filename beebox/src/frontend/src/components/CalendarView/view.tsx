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
import { localDay } from "@shared/local-day";
import type { RendererProps } from "../../file-type-registry";
import type { ReactNode } from "react";
import { List } from "../ui/List";

const DAYS_SHOWN = 30;

interface Window {
  /** The first day shown and the day `DAYS_SHOWN` days on, where the window ends, as `YYYY-MM-DD`. */
  first: string;
  last: string;
  /** The start of each of those days in the viewer's zone, for the query. */
  from: Date;
  to: Date;
  timeZone: string;
}

/** Today's start through `DAYS_SHOWN` days on, in the viewer's zone (the runtime's local zone). */
export function upcomingWindow(now: Date): Window {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + DAYS_SHOWN);
  return { first: localDay(from, timeZone), last: localDay(to, timeZone), from, to, timeZone };
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

/** A `YYYY-MM-DD` day's label, formatted at its UTC midnight in UTC so it is that day in every zone. */
const dayLabel = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const timeLabel = (start: string): string => new Date(start).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });

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
function dayOf(event: ListedEvent, timeZone: string): string {
  return event.allDay ? event.start : localDay(new Date(event.start), timeZone);
}

/** Events grouped under their day's label, in order. Grouped by the day itself, so two days never share a label's group. */
export function byDay(events: readonly ListedEvent[], timeZone: string): Array<[string, ListedEvent[]]> {
  const groups = new Map<string, ListedEvent[]>();
  for (const event of events) {
    const day = dayOf(event, timeZone);
    const group = groups.get(day);
    if (group) group.push(event);
    else groups.set(day, [event]);
  }
  return [...groups].map(([day, list]) => [dayLabel(day), list]);
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
  const query = trpc.calendar.cardEvents.useQuery({ path, from: window.from.toISOString(), to: window.to.toISOString() });
  if (query.isLoading) return <StatusMessage busy>Loading events…</StatusMessage>;
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
          <List gap="xs">
            {list.map((event) => (
              <li key={`${event.file}@${event.start}`} className="flex flex-wrap items-baseline gap-x-2">
                <Text material tone="muted" size="sm" className="w-20 shrink-0">{event.allDay ? "All day" : timeLabel(event.start)}</Text>
                <InlineAction intent="quiet" onClick={open(event.file)} title={event.file}>{event.summary}</InlineAction>
                {event.location === undefined ? null : <Text material tone="muted" size="sm">{event.location}</Text>}
              </li>
            ))}
          </List>
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
      <EventList path={data.path} window={upcomingWindow(new Date())} onNavigate={onNavigate} />
      <CardBody data={data} title={bodyHeadingTitle(frontmatter)} onNavigate={onNavigate} hideEmptyBody />
    </div>
  );
}
