# Box config: a malformed timezone degrades, never crashes

`_config/box.json`'s `timezone` is hand-editable — a typo (`"America/Chciago"`
instead of `"America/Chicago"`) is easy to make and easy to miss. Every
timezone-aware call site (the todo collector, `bbx todos`, `todos.list`, the
review sweep, session-context's ambient timezone line) feeds `loadBoxTimezone`'s
return value straight into `Intl.DateTimeFormat({ timeZone })`, which THROWS a
bare `RangeError` for an invalid IANA zone — so an unvalidated bad value would
take down every one of those call sites the moment they touched a date.
`loadBoxTimezone` validates the configured zone and falls back to `null`
(each caller's own `?? Intl.DateTimeFormat().resolvedOptions().timeZone`
fallback then supplies the host's zone) with a loud `console.warn`, rather
than propagating the crash.

```ts setup
import { loadBoxTimezone } from "../../src/core/box/config.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## No timezone configured: `null`, no warning

```ts
const box = await makeTmpBox();
await loadBoxTimezone(box.root)
=> null
```

## A valid IANA timezone loads as-is

```ts continue
await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
await loadBoxTimezone(box.root)
=> America/Chicago
```

## A malformed timezone degrades to `null` (host fallback), not a thrown `RangeError`

```ts continue
await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chciago" }));
await loadBoxTimezone(box.root)
=> null
```

```ts cleanup
await box.cleanup();
```
