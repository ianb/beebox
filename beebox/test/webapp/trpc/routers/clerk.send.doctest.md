# clerk.send — Send to box from the Clerk

`clerk.send` saves a page sent from the Clerk as a webpage card in
`_content/incoming/`, which git ignores, then lets quick chat place it
(docs/implemented-plans/clerk-quick-send.md). The chat gets the person's note, which may be
empty, and a reference to the card. Page text never becomes the message; the
page's title, site, and URL go to Jev as routing data.

These doctests use a synthetic box with git, the fake Jev service, and a
scripted chat runtime that claims message ids the way `send-dedup.ts` does.

```ts setup
import { readFile, readdir, rm, unlink } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { sendInput } from "../../../../src/webapp/trpc/clerk-contract.js";
import type { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import assert from "node:assert/strict";
import type { ReserveResult } from "../../../../src/core/chat/session/reserve.js";
import type { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import type { FakeJevService, JevService } from "../../../../src/services/jev.js";
import type { TmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { ChatRuntime, SendOutcome, SendTargetArgs, SendTargetResult, UserMessageSendArgs } from "../../../../src/webapp/chat-runtime.js";
import { setChatRuntime } from "../../../../src/webapp/chat-runtime.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { createFakeJev } from "../../../../src/services/jev.js";
import { executeMove } from "../../../../src/core/commands/move/command.js";
import { createCollectorContext } from "../../../../src/core/command-runner.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";

function caller(boxRoot: string, jev: JevService | undefined) {
  return appRouter.createCaller(trpcContext({
    boxRoot,
    isAuthenticatedOwner: true,
    services: jev === undefined ? {} : { jev },
    user: { email: "ari@example.com", name: "Ari" },
  }));
}

/** A chat runtime that records each send and answers a repeated message id as a duplicate. */
function scriptedRuntime(boxRoot: string) {
  const sends: string[] = [];
  const claimed = new Set<string | undefined>();
  // Partial fakes (runtime, registry, session): the code under test reads only registry.reserve, resolveSendTarget and sendUserMessage. ChatSessionRegistry is a class with private members, so its fake cannot be typed without a double cast.
  setChatRuntime(boxRoot, {
    registry: { reserve: async (input: Parameters<ChatSessionRegistry["reserve"]>[0]): Promise<ReserveResult> => ({ kind: "reserved", sessionId: input.sessionId }) } as ChatSessionRegistry,
    resolveSendTarget: async (args: SendTargetArgs): Promise<SendTargetResult> => ({ ok: true, target: { session: {} as ChatSession, id: args.sessionParam === "new" ? null : args.sessionParam } }),
    sendUserMessage: async (args: UserMessageSendArgs): Promise<SendOutcome> => {
      sends.push(args.message);
      if (claimed.has(args.messageId)) return { status: 200, body: { deduplicated: true } };
      claimed.add(args.messageId);
      return { status: 200, body: { turnId: "turn-1" } };
    },
  } as ChatRuntime);
  return sends;
}

/** A git box with a Garden landmark. Candidates: c0 a new chat in Garden, c1 a new general chat. */
async function gardenBox() {
  const box = await makeTmpBox({ git: true });
  await box.write("_content/Garden/Garden.landmark.card", "---\nnavigation:\n  label: Garden\n---\n");
  execFileSync("git", ["add", "-A"], { cwd: box.root });
  execFileSync("git", ["commit", "-qm", "garden"], { cwd: box.root });
  return box;
}

const clear = () => createFakeJev({ result: { model: "synthetic-jev", probabilities: { c0: 0.95, c1: 0.05 }, confidence: 0.95 } });
const unsure = () => createFakeJev({ result: { model: "synthetic-jev", probabilities: { c0: 0.5, c1: 0.5 }, confidence: 0.5 } });

/** What the fake Jev was asked to decide on: the message and the page, as the router sent them. */
function decisionState(jev: FakeJevService): { message: unknown; page: unknown } {
  const [call] = jev.calls;
  assert.ok(call && typeof call.state === "object" && call.state !== null && "message" in call.state && "page" in call.state, "Jev was asked once");
  return { message: call.state.message, page: call.state.page };
}

function page(id: string, overrides?: Partial<z.infer<typeof sendInput>>) {
  return { id, note: "", url: "https://example.com/beds", title: "Raised beds on a slope", siteName: "Example Gardens",
    readableMarkdown: "# Raised beds\n\nTerrace them.", frozenHtml: "<html><body>frozen</body></html>", ...overrides };
}

async function incoming(box: TmpBox) {
  return (await readdir(path.join(box.root, "_content/incoming"))).toSorted();
}

function gitStatus(box: TmpBox) {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: box.root, encoding: "utf8" }).trim();
}

async function failure(run: () => Promise<unknown>) {
  try { await run(); return "unexpected success"; }
  catch (error) { return error instanceof TRPCError ? `${error.code}: ${error.message}` : String(error); }
}
```

## A page with a note posts to the chat Jev picks, and the card stays out of git

The card is written to `_content/incoming/` with its frozen snapshot, and the
folder's own `.gitignore` keeps both out of `git status`. The delivered message
holds the note and the card reference; the page title is not in it. Jev sees
the page as data beside the note.

```ts
const box = await gardenBox();
const sends = scriptedRuntime(box.root);
const jev = clear();
const id = randomUUID();
const result = await caller(box.root, jev).clerk.send(page(id, { note: "for the slope out back" }));
const card = result.card;
({ result, incoming: await incoming(box), gitStatus: gitStatus(box), sends,
  jevState: decisionState(jev) })
=> {
  result: { card: "_content/incoming/Raised_beds_on_a_slope-«uuid».webpage.card", state: "sent", destination: { label: "New chat in Garden", sessionId: "«uuid»" } },
  incoming: [".gitignore", ".gitkeep", "Raised_beds_on_a_slope-«uuid».attach", "Raised_beds_on_a_slope-«uuid».webpage.card"],
  gitStatus: "",
  sends: ["<external-input source=\"browser-clerk\" source-ref=\"_content/incoming/Raised_beds_on_a_slope-«uuid».webpage.card\">for the slope out back</external-input>"],
  jevState: { message: "for the slope out back", page: { title: "Raised beds on a slope", url: "https://example.com/beds", site: "Example Gardens" } },
}
```

The card carries the send's id as `capture-id`, and the frozen page sits in its
attach folder.

```ts continue
const text = await readFile(path.join(box.root, card), "utf8");
({ captureId: text.match(/capture-id: (.*)/)?.[1] === id, body: text.slice(text.lastIndexOf("---") + 3).trim(),
  frozen: await readFile(path.join(box.root, card.replace(".webpage.card", ".attach/page.frozen")), "utf8") })
=> { captureId: true, body: "# Raised beds\n\nTerrace them.", frozen: "<html><body>frozen</body></html>" }
```

## A repeat of the same send writes nothing new

A lost response makes the Clerk send the same payload again. The box answers
from the stored send: one card, one delivery.

```ts continue
const again = await caller(box.root, jev).clerk.send(page(id, { note: "for the slope out back" }));
({ state: again.state, sameCard: again.card === card, cards: (await incoming(box)).filter((name) => name.endsWith(".webpage.card")).length, deliveries: sends.length })
=> { state: "sent", sameCard: true, cards: 1, deliveries: 1 }
```

## Filing the card with `bbx mv --commit`, then a late repeat

The chat's agent files the card. `bbx mv --commit` stages only paths git can
take: the card's old path was never tracked. The commit holds the card and its
frozen page. A repeat of the send after that still writes no card: the stored
send answers, naming the path it was delivered with.

```ts continue
const { ctx } = createCollectorContext(box.root);
const moved = await executeMove(ctx, { from: card, to: "_content/Garden/", commit: true });
const committed = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: box.root, encoding: "utf8" }).trim().split("\n");
const late = await caller(box.root, jev).clerk.send(page(id, { note: "for the slope out back" }));
({ moved: moved.success, committed, gitStatus: gitStatus(box), lateCard: late.card === card, incomingCards: (await incoming(box)).filter((name) => name.endsWith(".webpage.card")) })
=> {
  moved: true,
  committed: ["_content/Garden/Raised_beds_on_a_slope-«uuid».attach/page.frozen", "_content/Garden/Raised_beds_on_a_slope-«uuid».webpage.card"],
  gitStatus: "",
  lateCard: true,
  incomingCards: [],
}
```

Moving the filed card again, now that git tracks it, commits both files as
renames, with no old path left behind: a moved directory counts as tracked
when any file under it is.

```ts continue
const filed = `_content/Garden/${card.split("/").at(-1)}`;
const again2 = await executeMove(createCollectorContext(box.root).ctx, { from: filed, to: "_content/Reading/", commit: true });
const changed = execFileSync("git", ["show", "--name-status", "--format=", "HEAD"], { cwd: box.root, encoding: "utf8" }).trim().split("\n");
({ moved: again2.success, changed, gitStatus: gitStatus(box) })
=> {
  moved: true,
  changed: [
    "R100\t_content/Garden/Raised_beds_on_a_slope-«uuid».attach/page.frozen\t_content/Reading/Raised_beds_on_a_slope-«uuid».attach/page.frozen",
    "R100\t_content/Garden/Raised_beds_on_a_slope-«uuid».webpage.card\t_content/Reading/Raised_beds_on_a_slope-«uuid».webpage.card",
  ],
  gitStatus: "",
}
```

## The same id with a different page or note is refused

```ts continue
[await failure(() => caller(box.root, jev).clerk.send(page(id, { note: "for the slope out back", url: "https://example.com/other" }))),
  await failure(() => caller(box.root, jev).clerk.send(page(id, { note: "different words" })))]
=> [
  "CONFLICT: This send already holds a different page or note. Send it again as a new send.",
  "CONFLICT: This send already holds a different page or note. Send it again as a new send.",
]
```

## A page with no note that Jev cannot place waits for a choice

The view carries the page so the box screen can label the row; the message is
empty.

```ts
const box = await gardenBox();
scriptedRuntime(box.root);
const id = randomUUID();
const result = await caller(box.root, unsure()).clerk.send(page(id));
const row = (await caller(box.root, unsure()).quickChat.home()).open[0];
({ state: result.state, reason: result.reason, choices: (result.choices ?? []).map((choice) => choice.label), row: { message: row?.message, page: row?.page } })
=> { state: "needs-choice", reason: "uncertain", choices: ["New chat in Garden", "New general chat"],
  row: { message: "", page: { title: "Raised beds on a slope", url: "https://example.com/beds" } } }
```

## A card filed before the choice is delivered from where it is now

Someone files the waiting card from Browse, renaming it. Choosing a
destination delivers the card's current path, found by its `capture-id`.

```ts continue
const sends = scriptedRuntime(box.root);
const { ctx } = createCollectorContext(box.root);
await executeMove(ctx, { from: result.card, to: "_content/Garden/Beds.webpage.card", commit: true });
const chosen = await caller(box.root, unsure()).quickChat.choose({ id, candidateId: "c0" });
({ state: chosen.state, sends })
=> { state: "sent", sends: ["<external-input source=\"browser-clerk\" source-ref=\"_content/Garden/Beds.webpage.card\"></external-input>"] }
```

## A card removed before the choice is not delivered

```ts
const box = await gardenBox();
const sends = scriptedRuntime(box.root);
const id = randomUUID();
const result = await caller(box.root, unsure()).clerk.send(page(id));
await unlink(path.join(box.root, result.card));
const chosen = await caller(box.root, unsure()).quickChat.choose({ id, candidateId: "c0" });
({ state: chosen.state, lastError: chosen.lastError, sends })
=> { state: "sending", lastError: "The sent page was removed.", sends: [] }
```

## Two sends with the same title get two cards

```ts
const box = await gardenBox();
scriptedRuntime(box.root);
const [first, second] = [randomUUID(), randomUUID()];
await caller(box.root, clear()).clerk.send(page(first));
await caller(box.root, clear()).clerk.send(page(second));
(await incoming(box)).filter((name) => name.endsWith(".webpage.card")).length
=> 2
```

## A card saved before the box stopped is routed on the next attempt

The box can stop after writing the card and before storing the send. The
Clerk's repeat finds the card by its id and routes it; no second card.

```ts
const box = await gardenBox();
const sends = scriptedRuntime(box.root);
const id = randomUUID();
await caller(box.root, clear()).clerk.send(page(id, { note: "keep" }));
await rm(path.join(box.root, ".beebox/quick-chat", `${id}.json`), { force: true });
sends.length = 0;
const result = await caller(box.root, clear()).clerk.send(page(id, { note: "keep" }));
({ state: result.state, cards: (await incoming(box)).filter((name) => name.endsWith(".webpage.card")).length })
=> { state: "sent", cards: 1 }
```

## Without a routing key, the page waits with recent chats to choose from

```ts
const box = await gardenBox();
scriptedRuntime(box.root);
const result = await caller(box.root, undefined).clerk.send(page(randomUUID(), { note: "later" }));
({ state: result.state, reason: result.reason })
=> { state: "needs-choice", reason: "routing-unavailable" }
```
