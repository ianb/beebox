# The ambient todo line (`core/todo/ambient-summary.ts`)

`computeTodoAmbientLine(boxRoot)` (`docs/implemented-plans/todo-annotation.md` Track 5a)
is the runtime-computed, only-when-nonzero one-liner injected into chat and
reactor agent context — never persisted (see the module doc for why a
MAP.md-style count doesn't work here).

```ts setup
import { computeTodoAmbientLine } from "../../src/core/todo/ambient-summary.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const MEMO_FM = "status: new\ncreated: 2026-07-01T10:00:00Z\n";

function memo(body: string): string {
  return `---\n${MEMO_FM}---\n${body}`;
}

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

async function seedBox() {
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
  return box;
}
```

## Nothing on the plate: no line at all

A box with no todos, or only quiet/done/dropped/parked ones, gets `null` —
not an empty string, not a "0 todos" line.

```ts
const box = await seedBox();
await box.write(
  "store/a.memo.card",
  memo(
    '{% todo id="quiet" start="2026-08-05" due="2026-08-10" %}Not yet{% /todo %}\n\n' +
    '{% todo id="done" status="done" %}Already finished{% /todo %}\n'
  )
);
await computeTodoAmbientLine(box.root)
=> null
```

## Open todos on the plate: counts, singular/plural, and the escalated note

```ts continue
const box2 = await seedBox();
await box2.write(
  "store/b.memo.card",
  memo('{% todo id="one" %}Solo undated todo{% /todo %}\n')
);
await computeTodoAmbientLine(box2.root)
=> 1 open todo on the plate — `bbx todos`
```

Escalated (past-due) todos get called out separately, and the count is
plural once there's more than one:

```ts continue
const box3 = await seedBox();
await box3.write(
  "store/c.memo.card",
  memo(
    '{% todo id="past-due" due="2026-07-01" %}Overdue{% /todo %}\n\n' +
    '{% todo id="on-plate" %}Also on the plate{% /todo %}\n'
  )
);
await computeTodoAmbientLine(box3.root)
=> 2 open todos on the plate (1 escalated) — `bbx todos`
```
