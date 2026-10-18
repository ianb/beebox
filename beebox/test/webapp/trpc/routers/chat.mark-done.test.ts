// # `chat.markDone`: the boxholder's close mark on a chat
//
// A finished conversation should not sit in the chat list looking like a live
// one. `chat.markDone` sets `done: true` on the chat's husk card, and
// `chat.sessions` reports it so the Recent chats panel can sort done chats into
// their own muted group below the live ones (`docs/implemented-plans/chat-titles.md`
// § Track D). Done is a state, not a deletion: the chat stays listed and
// resumable, and the nightly review ignores the mark.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import type { TmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";

const SESSION = "aaaa1111-2222-4333-8444-555566667777";
const OTHER = "bbbb1111-2222-4333-8444-555566667777";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, actor: "none" });
  return appRouter.createCaller(ctx);
}

async function seedChat(box: TmpBox, { sessionId, husk }: { sessionId: string; husk: string }) {
  const logPath = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, JSON.stringify({
    type: "user", uuid: `u-${sessionId}`, timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
  }) + "\n");
  await box.write(`_content/chat/web/2026-07-28_${sessionId.slice(0, 8)}.chat.card`, `---\nsession: ${sessionId}\n${husk}---\n\nNotes the boxholder wrote.\n`);
}

/** Each listed chat as `<id prefix> done|live`, sorted. */
async function listed(boxRoot: string) {
  const { sessions } = await caller(boxRoot).chat.sessions();
  return sessions.map((s) => `${s.sessionId.slice(0, 8)} ${s.done ? "done" : "live"}`).toSorted();
}

// ## Marking a chat done writes the husk and the list reports it
//
// The mark is one frontmatter field. The body the boxholder wrote is carried
// through untouched.
void test("The mark is one frontmatter field.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L51
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  await seedChat(box, { sessionId: SESSION, husk: "title: Planning a small birthday dinner\n" });
  await seedChat(box, { sessionId: OTHER, husk: "" });

  // doctest:L56
  t.check(await caller(box.root).chat.markDone({ sessionId: SESSION, done: true }), {
    huskPath: "_content/chat/web/2026-07-28_aaaa1111.chat.card",
    done: true,
  });

  // doctest:L59
  await t.checkText(await box.read("_content/chat/web/2026-07-28_aaaa1111.chat.card"), `---
session: aaaa1111-2222-4333-8444-555566667777
title: Planning a small birthday dinner
done: true
---
«blankline»
Notes the boxholder wrote.`);

  // doctest:L68
  t.check(await listed(box.root), [
    "aaaa1111 done",
    "bbbb1111 live",
  ]);

  // The session menu reads the mark for the current chat through `chat.label`, so
  // its toggle can say "Mark active" instead of "Mark done".

  // doctest:L76
  t.check(await caller(box.root).chat.label({ session: SESSION }), {
    label: "Planning a small birthday dinner",
    done: true,
  });

  // ## Unmarking clears the field
  //
  // The field is removed rather than set to `false`: its absence means active.

  // doctest:L85
  await caller(box.root).chat.markDone({ sessionId: SESSION, done: false });
  await t.checkText(await box.read("_content/chat/web/2026-07-28_aaaa1111.chat.card"), `---
session: aaaa1111-2222-4333-8444-555566667777
title: Planning a small birthday dinner
---
«blankline»
Notes the boxholder wrote.`);

  // doctest:L95
  t.check(await listed(box.root), [
    "aaaa1111 live",
    "bbbb1111 live",
  ]);
});

// ## A chat with no card cannot be marked
//
// A brand-new chat has no husk yet, so there is nothing to mark. `chat.label`
// reports `done: null` for it, and the session menu offers no toggle at all.
void test("A brand-new chat has no husk yet, so there is nothing to mark.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L109
  const box = await makeTmpBox();
  t.check(await caller(box.root).chat.label({ session: SESSION }), {
    label: null,
    done: null,
  });

  // Calling the mutation anyway is refused, rather than inventing a card.

  // doctest:L117
  t.check(await caller(box.root).chat.markDone({ sessionId: SESSION, done: true }).catch((e) => e.message), "This chat has no card to mark");
});

// ## A hand-written non-boolean `done` reads as active, with a warning
//
// `done` is a named boolean. A hand-edited `done: "finished"` fails card
// validation, and the chat lists read it as absent and warn rather than sorting
// on a value nothing defined.
void test("done is a named boolean.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L132
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  await seedChat(box, { sessionId: SESSION, husk: "done: finished\n" });

  // doctest:L136
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  const rows = await listed(box.root);
  console.warn = warn;

  // doctest:L142
  t.check(rows, [
    "aaaa1111 live",
  ]);

  // doctest:L145
  t.check(warnings.filter((w) => w.includes("non-boolean done")), [
    "chat-husk: _content/chat/web/2026-07-28_aaaa1111.chat.card has a non-boolean done \"finished\"; ignoring it",
  ]);
});
