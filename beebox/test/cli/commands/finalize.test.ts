// # `bbx finalize`: questions are aged before they are announced
//
// `finalizeQuestions(boxRoot, services)` (`src/cli/commands/finalize.ts`) is the
// question step of `bbx finalize`. It ages pending questions first (nudge, then
// expire; `src/core/question-aging.ts`) and then notifies about the questions
// still pending (`src/core/question-alert.ts`). In the other order, an old box's
// first finalize announced every old question and then expired them all.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import { finalizeQuestions } from "../../../src/cli/commands/finalize.js";
import { DEFAULT_EXPIRE_AFTER_MS } from "../../../src/core/question-aging.js";
import { addSubscription } from "../../../src/core/push-subscriptions.js";
import { createFakePush } from "../../../src/services/push.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

process.env.BBX_PUSH_STORE_DIR = path.join(os.tmpdir(), `bbx-finalize-${process.pid}-${Date.now()}`);

const NOW = new Date("2026-06-29T12:00:00Z");
const question = (prompt: string, askedAt: Date) =>
  `---\nprompt: ${prompt}\ninput:\n  type: text\nasked-at: ${askedAt.toISOString()}\n---\n`;

// ## One expired-age question and one fresh: only the fresh one is announced
void test("One expired-age question and one fresh: only the fresh one is announced", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_TIME;
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: { endpoint: "https://push.example/f1", keys: { p256dh: "p", auth: "a" } }, now: NOW });
  await box.write("_bookkeeping/questions/Old.question.card", question("Still want the old thing?", new Date(NOW.getTime() - DEFAULT_EXPIRE_AFTER_MS - 60_000)));
  await box.write("_bookkeeping/questions/Fresh.question.card", question("Which day works?", NOW));
  box.commitAll("seed questions");
  process.env.BBX_TIME = NOW.toISOString();

  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args) => { lines.push(args.join(" ")); };
  await finalizeQuestions(box.root, { push: createFakePush() });
  console.log = origLog;
  t.check(lines, ["  Question aging: 0 nudged, 1 expired", "  Question alert: 1 new question(s)"]);

  await t.checkText(await box.read("_bookkeeping/questions/Old.question.card"), `---
type: question
prompt: Still want the old thing?
input:
  type: text
asked-at: 2026-05-30T11:59:00.000Z
expired-at: 2026-06-29T12:00:00.000Z
---`);

  const sent = (await readRecent(box.root, { days: 1, now: NOW })).filter((n) => n.intent.source === "question-alert");
  t.check(sent.map((n) => [n.intent.target, n.intent.body]), [
    [
      "question:_bookkeeping/questions/Fresh.question.card",
      "- Which day works?",
    ],
  ]);
});
