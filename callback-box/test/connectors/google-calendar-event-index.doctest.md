# Calendar events are tracked per (event, calendar)

A Google event id is unique within ONE calendar, not across calendars, so a box
syncing two calendars can hold two different events with the same id. The
connector's index (`eventFiles` in
`config/connectors/google-calendar-state.json`) is therefore keyed
`<eventId> <calendarId>` — see `src/connectors/google-calendar-event-index.ts`
for why the separator is a space and why the calendar id comes last.

```ts setup
import { join } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import { createFakeGoogleCalendar } from "../../src/services/google-calendar.js";
import type {
  CalendarEvent,
  CalendarListEntry,
  EventsListResult,
  GoogleCalendarService,
} from "../../src/services/google-calendar.js";
import { createGoogleCalendarConnector } from "../../src/connectors/google-calendar.js";
import { loadCalendarState } from "../../src/connectors/google-calendar-state.js";
import { contentHash } from "../../src/lib/content-hash.js";

const NOW = () => new Date("2026-06-15T12:00:00Z");

/**
 * A fake that keeps a SEPARATE event list per calendar — the shipped
 * `createFakeGoogleCalendar` returns the same list for every calendar id, which
 * is exactly the distinction under test here. `silent` makes one calendar's
 * next list return nothing, the way an incremental sync with no news does.
 */
interface RoutedCalendar extends GoogleCalendarService {
  byCalendar: Record<string, CalendarEvent[]>;
  silent: Set<string>;
  patched: string[];
  inserted: string[];
}

function makeRoutedCalendar(byCalendar: Record<string, CalendarEvent[]>): RoutedCalendar {
  let nextId = 1;
  const listOf = (calendarId: string): CalendarEvent[] => {
    const events = fake.byCalendar[calendarId];
    if (!events) throw new Error(`no such calendar: ${calendarId}`);
    return events;
  };
  const fake: RoutedCalendar = {
    byCalendar,
    silent: new Set<string>(),
    patched: [],
    inserted: [],
    async listCalendars(): Promise<CalendarListEntry[]> {
      return Object.keys(fake.byCalendar).map((id) => ({ id, summary: id, accessRole: "owner" }));
    },
    async listEvents(calendarId): Promise<EventsListResult> {
      const items = fake.silent.has(calendarId) ? [] : listOf(calendarId);
      return { items: [...items], nextSyncToken: `token-${calendarId}` };
    },
    async insertEvent(calendarId, event): Promise<CalendarEvent> {
      const full: CalendarEvent = { ...event, id: `evt-new-${String(nextId++)}`, status: "confirmed" };
      fake.inserted.push(`${calendarId}/${full.id}`);
      listOf(calendarId).push(full);
      return full;
    },
    async patchEvent(calendarId, { eventId, event }): Promise<CalendarEvent> {
      const events = listOf(calendarId);
      const idx = events.findIndex((e) => e.id === eventId);
      if (idx === -1) throw new Error(`no event ${eventId} on ${calendarId}`);
      const existing = events[idx];
      if (!existing) throw new Error("unreachable: index came from findIndex");
      const merged: CalendarEvent = { ...existing, ...event, id: existing.id, status: existing.status };
      events[idx] = merged;
      fake.patched.push(`${calendarId}/${eventId}`);
      return merged;
    },
    async deleteEvent(calendarId, eventId): Promise<void> {
      fake.byCalendar[calendarId] = listOf(calendarId).filter((e) => e.id !== eventId);
    },
  };
  return fake;
}

const trackedKeys = async (root: string): Promise<string[]> =>
  Object.keys((await loadCalendarState(root)).eventFiles).sort();

const icsFiles = async (dir: string): Promise<string[]> =>
  (await readdir(dir)).filter((f) => f.endsWith(".ics")).sort();
```

## Two calendars, one event id, one date, two files

Both calendars return an event called `evt-shared`, on the same day. They are
different events — a standup at work, a dentist appointment at home — and this
is the ordinary case: one invitation copied into both calendars. The natural
file name (`{date}_{shortId}.ics`) carries neither the calendar nor anything
else that separates them, so the second event's name is disambiguated with a
short hash of its calendar id. Each event ends up with its own file.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/google-calendar.json", JSON.stringify({
  calendars: ["work", "home"],
}, null, 2));
box.commitAll("init two-calendar box");

const calendar = makeRoutedCalendar({
  work: [{
    id: "evt-shared",
    status: "confirmed",
    summary: "Standup",
    start: { dateTime: "2026-06-10T09:00:00Z" },
    end: { dateTime: "2026-06-10T09:15:00Z" },
  }],
  home: [{
    id: "evt-shared",
    status: "confirmed",
    summary: "Dentist",
    start: { dateTime: "2026-06-10T15:00:00Z" },
    end: { dateTime: "2026-06-10T16:00:00Z" },
  }],
});

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
const dir = join(box.root, "store/calendar");
const first = await connector.sync();
JSON.stringify({ success: first.success, files: await icsFiles(dir) })
=> {"success":true,"files":["2026-06-10_t-shared.ics","2026-06-10_t-shared_4ea140.ics"]}
```

Both are tracked, under one key each. Keyed by the bare id, the second sync
would have overwritten the first's entry and left its file untracked:

```ts continue
JSON.stringify(await trackedKeys(box.root))
=> ["evt-shared home","evt-shared work"]
```

Each file names the calendar it came from:

```ts continue
const workIcs = await readFile(join(dir, "2026-06-10_t-shared.ics"), "utf-8");
const homeIcs = await readFile(join(dir, "2026-06-10_t-shared_4ea140.ics"), "utf-8");
JSON.stringify({
  work: workIcs.includes("X-CB-CALENDAR-ID:work"),
  home: homeIcs.includes("X-CB-CALENDAR-ID:home"),
})
=> {"work":true,"home":true}
```

## The pending-edit pass pushes each edit to its own calendar

Edit the home event's file, and let home's next incremental sync return nothing
— the pull never sees the edit, so the pending-edit pass owns it. Work's pull
still reconciles ITS `evt-shared`, which must not make the pass skip home's.

```ts continue
calendar.silent.add("home");
await writeFile(join(dir, "2026-06-10_t-shared_4ea140.ics"), homeIcs.replace("SUMMARY:Dentist", "SUMMARY:Dentist MINE"));

const second = await connector.sync();
JSON.stringify({
  success: second.success,
  patched: calendar.patched,
  remote: calendar.byCalendar["home"]?.[0]?.summary,
  work: calendar.byCalendar["work"]?.[0]?.summary,
})
=> {"success":true,"patched":["home/evt-shared"],"remote":"Dentist MINE","work":"Standup"}
```

## A cancellation deletes only its own calendar's file

Work cancels its standup. Home's dentist appointment keeps its file and its
entry — under the bare-id key, the cancellation deleted whichever file was
written last.

```ts continue
calendar.silent.delete("home");
calendar.byCalendar["work"] = [{
  id: "evt-shared",
  status: "cancelled",
}];

const third = await connector.sync();
JSON.stringify({
  success: third.success,
  files: await icsFiles(dir),
  tracked: await trackedKeys(box.root),
})
=> {"success":true,"files":["2026-06-10_t-shared_4ea140.ics"],"tracked":["evt-shared home"]}
```

```ts cleanup
await box.cleanup();
```

## Two entries naming one file are deduped on the way in

A box that synced under the old bare-id keys can have written two events into
one file. Every pass downstream assumes one file per entry — the pending-edit
pass patches "the" event a file belongs to — so the index is deduped once per
sync. Here neither entry records a hash, so there is nothing to choose on and
index order decides. Untracking the loser is safe because the file stays tracked
by the keeper, so the orphan scan never re-inserts it.

```ts continue
const statePath = join(box.root, "config/connectors/google-calendar-state.json");
const collided = {
  version: 2,
  syncTokens: {},
  eventFiles: {
    "evt-shared home": { filename: "2026-06-10_t-shared_4ea140.ics", calendarId: "home" },
    "evt-ghost work": { filename: "2026-06-10_t-shared_4ea140.ics", calendarId: "work" },
  },
};
await writeFile(statePath, JSON.stringify(collided, null, 2));

const deduped = await connector.sync();
JSON.stringify({
  success: deduped.success,
  blamed: deduped.error?.includes(
    "store/calendar/2026-06-10_t-shared_4ea140.ics (stale-cleanup, local: two tracked events named one file; this entry was untracked)",
  ),
  tracked: await trackedKeys(box.root),
})
=> {"success":false,"blamed":true,"tracked":["evt-shared home"]}
```

When one entry's recorded hash DOES match the file's bytes, that entry keeps it
whatever the order — it is the one the file was last written for. Keeping the
other would leave a hash mismatch, which the pending-edit pass reads as an edit
and patches into the wrong calendar's event: the exact failure this dedupe
exists to prevent.

```ts continue
const homeFile = "2026-06-10_t-shared_4ea140.ics";
const homeHash = contentHash(await readFile(join(dir, homeFile), "utf-8"));
await writeFile(statePath, JSON.stringify({
  version: 2,
  syncTokens: {},
  eventFiles: {
    // First in order, and NOT what the file holds.
    "evt-ghost work": { filename: homeFile, calendarId: "work", contentHash: "0000000000000000" },
    "evt-shared home": { filename: homeFile, calendarId: "home", contentHash: homeHash },
  },
}, null, 2));

const byHash = await connector.sync();
JSON.stringify({
  blamed: byHash.error?.includes(`store/calendar/${homeFile} (stale-cleanup`),
  tracked: await trackedKeys(box.root),
})
=> {"blamed":true,"tracked":["evt-shared home"]}
```

## A pre-composite-key state file is migrated on load

State written before the key change is keyed by the bare event id and carries no
`version`. It is re-keyed on load, from each entry's own `calendarId` — and the
legacy plain-filename entries, which record no calendar at all, are kept under
the `(legacy)` sentinel rather than dropped. Dropping one would leave its `.ics`
untracked, and the orphan scan inserts an untracked `.ics` into Google as a
brand-new event.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);

box.commitAll("init box");

const calendar = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [{
    id: "evt-old",
    status: "confirmed",
    summary: "Standing meeting",
    start: { dateTime: "2026-06-08T09:00:00Z" },
    end: { dateTime: "2026-06-08T10:00:00Z" },
  }],
});
const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
const seeded = await connector.sync();
const dir = join(box.root, "store/calendar");
JSON.stringify({ success: seeded.success, files: await icsFiles(dir) })
=> {"success":true,"files":["2026-06-08_evt-old.ics"]}
```

Rewrite the state the way the old connector wrote it: bare-id keys, no version
marker, and `evt-old` as a bare filename string (the oldest format of all).

A second file joins it, tracked only by an old-format entry — an event Google
no longer returns, so nothing but the index says it is ours.

```ts continue
const older = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
  "BEGIN:VEVENT\r\nUID:evt-other\r\nSUMMARY:Older\r\n" +
  "DTSTART:20260620T090000Z\r\nDTEND:20260620T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
await writeFile(join(dir, "2026-06-20_vt-other.ics"), older);

const statePath = join(box.root, "config/connectors/google-calendar-state.json");
await writeFile(statePath, JSON.stringify({
  syncTokens: {},
  eventFiles: {
    "evt-old": "2026-06-08_evt-old.ics",
    "evt-other": { filename: "2026-06-20_vt-other.ics", calendarId: "primary" },
  },
}, null, 2));

JSON.stringify(await trackedKeys(box.root))
=> ["evt-old (legacy)","evt-other primary"]
```

The next sync is the one that could do damage: it must neither re-insert the two
tracked files as new Google events nor lose track of them. `evt-old` comes back
in the pull and is adopted onto its real calendar; `evt-other` — which Google
does not return — keeps its file under the re-keyed entry.

```ts continue
const after = await connector.sync();
JSON.stringify({
  success: after.success,
  remoteEvents: calendar.events.length,
  files: await icsFiles(dir),
  tracked: await trackedKeys(box.root),
})
=> {"success":true,"remoteEvents":1,"files":["2026-06-08_evt-old.ics","2026-06-20_vt-other.ics"],"tracked":["evt-old primary","evt-other primary"]}
```

The rewritten file carries the version marker:

```ts continue
const saved: { version?: number } = JSON.parse(await readFile(statePath, "utf-8"));
saved.version
=> 2
```

The marker is what we WRITE, never what we trust on the way in: normalizing is
gated on the shape of the keys themselves. A marked file can still hold a bare
key — a hand repair, an older binary writing between two runs of this one — and
a bare key is invisible to every lookup, so the stale pass would read its event
as deleted on Google and remove the file.

```ts continue
const marked: { version: number; syncTokens: Record<string, string>; eventFiles: Record<string, unknown> } =
  JSON.parse(await readFile(statePath, "utf-8"));
const other = marked.eventFiles["evt-other primary"];
delete marked.eventFiles["evt-other primary"];
marked.eventFiles["evt-other"] = other;
await writeFile(statePath, JSON.stringify(marked, null, 2));

JSON.stringify(await trackedKeys(box.root))
=> ["evt-old primary","evt-other primary"]
```

```ts cleanup
await box.cleanup();
```
