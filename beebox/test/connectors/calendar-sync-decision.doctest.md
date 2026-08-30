# Google Calendar sync decision policy

`decideCalendarSync` (`src/connectors/google-calendar-decide.ts`) is the single
pure function holding the connector's who-wins precedence. The IO passes gather
booleans from disk/state and dispatch on its `SyncDecision`. It has no fs or
API dependency, so the whole policy is exercised here.

```ts setup
import { decideCalendarSync } from "../../src/connectors/google-calendar-decide.js";

const kind = (s: Parameters<typeof decideCalendarSync>[0]) => decideCalendarSync(s).kind;
```

## Pull pass — a remote event we already track

A new (untracked) remote event is written down: remote-wins.

```ts
kind({ source: "remote-event", tracked: false, localEdited: false, remoteChanged: false })
=> remote-wins
```

An unedited local file is refreshed from Google: remote-wins.

```ts
kind({ source: "remote-event", tracked: true, localEdited: false, remoteChanged: false })
=> remote-wins
```

A local edit with no remote change is pushed: local-wins.

```ts
kind({ source: "remote-event", tracked: true, localEdited: true, remoteChanged: false })
=> local-wins
```

The one asymmetric rule — a local edit that collides with a remote change is
discarded; remote is authoritative.

```ts
kind({ source: "remote-event", tracked: true, localEdited: true, remoteChanged: true })
=> remote-wins
```

## Pull pass — a cancelled remote event

```ts
kind({ source: "remote-cancelled", tracked: true })
=> delete

kind({ source: "remote-cancelled", tracked: false })
=> noop
```

## Push pass — a local X-BBX-DELETE marker

Deletes only when under the per-sync cap and the state knows the calendar id;
otherwise it's skipped with a reason.

```ts
JSON.stringify(decideCalendarSync({ source: "local-delete-marker", hasCalendarId: true, underDeleteCap: true }))
=> {"kind":"delete"}

JSON.stringify(decideCalendarSync({ source: "local-delete-marker", hasCalendarId: true, underDeleteCap: false }))
=> {"kind":"noop","reason":"reached per-sync delete cap"}

JSON.stringify(decideCalendarSync({ source: "local-delete-marker", hasCalendarId: false, underDeleteCap: true }))
=> {"kind":"noop","reason":"no calendar ID in state"}
```

The cap is checked before the calendar id, matching the original inline order.

```ts
JSON.stringify(decideCalendarSync({ source: "local-delete-marker", hasCalendarId: false, underDeleteCap: false }))
=> {"kind":"noop","reason":"reached per-sync delete cap"}
```
