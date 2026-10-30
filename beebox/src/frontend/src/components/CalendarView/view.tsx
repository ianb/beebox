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
  from: Date;
  to: Date;
}

/** Today's start through `DAYS_SHOWN` days on, in the viewer's zone. */
function upcomingWindow(): Window {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + DAYS_SHOWN);
  return { from, to };
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

const dayLabel = (date: Date): string => date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeLabel = (date: Date): string => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

interface ListedEvent {
  start: string;
  allDay: boolean;
  summary: string;
  location?: string | undefined;
  file: string;
}

/** When an event starts, for display: an all-day `2026-11-05` is that local date, not UTC midnight. */
function startOf(event: ListedEvent): Date {
  if (!event.allDay) return new Date(event.start);
  const [y, m, d] = event.start.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Events grouped under their day's label, in order. */
function byDay(events: readonly ListedEvent[]): Array<[string, ListedEvent[]]> {
  const groups = new Map<string, ListedEvent[]>();
  for (const event of events) {
    const label = dayLabel(startOf(event));
    const group = groups.get(label);
    if (group) group.push(event);
    else groups.set(label, [event]);
  }
  return [...groups];
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
        <Text material tone="muted">No events between {dayLabel(window.from)} and {dayLabel(window.to)}.</Text>
      ) : null}
      {byDay(events).map(([day, list]) => (
        <section key={day} className="flex flex-col gap-1">
          <Text material weight="semibold" size="sm">{day}</Text>
          <ul className="flex flex-col gap-0.5">
            {list.map((event) => (
              <li key={`${event.file}@${event.start}`} className="flex flex-wrap items-baseline gap-x-2">
                <Text material tone="muted" size="sm" className="w-20 shrink-0">{event.allDay ? "All day" : timeLabel(new Date(event.start))}</Text>
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
      <EventList path={data.path} window={upcomingWindow()} onNavigate={onNavigate} />
      <CardBody data={data} title={bodyHeadingTitle(frontmatter)} onNavigate={onNavigate} hideEmptyBody />
    </div>
  );
}
