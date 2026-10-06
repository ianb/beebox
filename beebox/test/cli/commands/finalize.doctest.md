# `bbx finalize`: questions are aged before they are announced

`finalizeQuestions(boxRoot, services)` (`src/cli/commands/finalize.ts`) is the
question step of `bbx finalize`. It ages pending questions first (nudge, then
expire; `src/core/question-aging.ts`) and then notifies about the questions
still pending (`src/core/question-alert.ts`). In the other order, an old box's
first finalize announced every old question and then expired them all.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { finalizeQuestions } from "../../../src/cli/commands/finalize.js";
import { DEFAULT_EXPIRE_AFTER_MS } from "../../../src/core/question-aging.js";
import { addSubscription } from "../../../src/core/push-subscriptions.js";
import { createFakePush } from "../../../src/services/push.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

process.env.BBX_PUSH_STORE_DIR = path.join(os.tmpdir(), `bbx-finalize-${process.pid}-${Date.now()}`);

const NOW = new Date("2026-06-29T12:00:00Z");
const question = (prompt, askedAt) =>
  `---\nprompt: ${prompt}\ninput:\n  type: text\nasked-at: ${askedAt.toISOString()}\n---\n`;
```

## One expired-age question and one fresh: only the fresh one is announced

```ts
const box = await makeTmpBox({ git: true });
await box.seed(".beebox/box.json", JSON.stringify({ shapeVersion: 3, version: "1.0.0", created: NOW.toISOString() }));
await addSubscription({ boxSlug: await boxSlug(box.root), subscription: { endpoint: "https://push.example/f1", keys: { p256dh: "p", auth: "a" } }, now: NOW });
await box.write("_bookkeeping/questions/Old.question.card", question("Still want the old thing?", new Date(NOW.getTime() - DEFAULT_EXPIRE_AFTER_MS - 60_000)));
await box.write("_bookkeeping/questions/Fresh.question.card", question("Which day works?", NOW));
box.commitAll("seed questions");
process.env.BBX_TIME = NOW.toISOString();

const lines = [];
const origLog = console.log;
console.log = (...args) => { lines.push(args.join(" ")); };
await finalizeQuestions(box.root, { push: createFakePush() });
console.log = origLog;
lines.join("\n")
=>
  Question aging: 0 nudged, 1 expired
  Question alert: 1 new question(s)

(await box.read("_bookkeeping/questions/Old.question.card")).includes("expired-at:")
=> true

const sent = (await readRecent(box.root, { days: 1, now: NOW })).filter((n) => n.intent.source === "question-alert");
JSON.stringify(sent.map((n) => [n.intent.target, n.intent.body]))
=> [["question:_bookkeeping/questions/Fresh.question.card","- Which day works?"]]
```

```ts cleanup
delete process.env.BBX_TIME;
await box.cleanup();
```
