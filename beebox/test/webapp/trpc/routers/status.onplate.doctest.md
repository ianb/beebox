# `status.status` — `counts.onPlateTodos`

`docs/implemented-plans/todo-annotation.md` Track 4's header-badge count: open todos that
are `escalated` or `on-plate` NOW, box-wide — added to the same `status.status`
payload the pending-questions count already lives on (`AppNav`'s `PlateBadge`
reads it the same way `QuestionsBadge` reads `pendingQuestions`). `quiet`
todos (not yet started) and terminal statuses (`done`/`dropped`/`parked`)
don't count.

```ts setup
import { statusRouter } from "../../../../src/webapp/trpc/routers/status.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { TmpBox } from "../../../helpers/doctest-helpers.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";

function contextFor(box: TmpBox) {
  const ctx: TrpcContext = trpcContext({ boxRoot: box.root, boxSlug: "t", isAuthenticatedOwner: true });
  return statusRouter.createCaller(ctx);
}

const MARKER = JSON.stringify({ shapeVersion: 3, version: "1.0.0", created: "2026-01-01T00:00:00Z" });

function doc(body: string) {
  return `---\ntitle: Notes\n---\n${body}`;
}

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";
```

## Escalated + on-plate count; quiet and done are excluded

```ts
const box = await makeTmpBox({ git: true });
await box.seed(".beebox/box.json", MARKER);
await box.write(
  "_content/a.doc.card",
  doc(
    '{% todo due="2026-07-01" %}Overdue thing{% /todo %}\n\n' +      // escalated
    '{% todo %}Undated thing{% /todo %}\n\n' +                       // on-plate
    '{% todo start="2026-09-01" %}Not yet{% /todo %}\n\n' +          // quiet
    '{% todo status="done" %}Already finished{% /todo %}\n'         // done
  )
);
box.commitAll("seed");

const { counts } = await contextFor(box).status();
counts.onPlateTodos
=> 2
```

## Zero when there are none

```ts continue
await box.write("_content/a.doc.card", doc("No todos here.\n"));
box.commitAll("clear");

const after = await contextFor(box).status();
after.counts.onPlateTodos
=> 0
```

```ts cleanup
await box.cleanup();
```
