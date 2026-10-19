// # clerk.send — Send to box from the Clerk
//
// `clerk.send` saves a page sent from the Clerk as a webpage card in
// `_content/incoming/`, which git ignores, then lets quick chat place it
// (docs/implemented-plans/clerk-quick-send.md). The chat gets the person's note, which may be
// empty, and a reference to the card. Page text never becomes the message; the
// page's title, site, and URL go to Jev as routing data.
//
// These tests use a synthetic box with git, the fake Jev service, and a
// scripted chat runtime that claims message ids the way `send-dedup.ts` does.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, uuid } from "@ianbicking/tap-check/check";
import { readFile, readdir, rm, unlink } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { sendInput } from "../../../../src/webapp/trpc/clerk-contract.js";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import assert from "node:assert/strict";
import type { ReserveResult } from "../../../../src/core/chat/session/reserve.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { ChatScheduleManager } from "../../../../src/core/chat/schedules/core.js";
import type { FakeJevService, JevService } from "../../../../src/services/jev.js";
import type { TmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { ChatRuntime, SendOutcome, SendTargetArgs, SendTargetResult, UserMessageSendArgs } from "../../../../src/webapp/chat-runtime.js";
import { setChatRuntime } from "../../../../src/webapp/chat-runtime.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { createFakeJev } from "../../../../src/services/jev.js";
import { executeMove } from "../../../../src/core/commands/move/command.js";
import { createCollectorContext } from "../../../../src/core/command-runner.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

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
  // The code under test reads only registry.reserve, resolveSendTarget and sendUserMessage.
  // The class-typed parts are prototype-backed objects: they carry the class type without running its constructor.
  const registry = Object.assign(Object.create(ChatSessionRegistry.prototype), {
    reserve: async (input: Parameters<ChatSessionRegistry["reserve"]>[0]): Promise<ReserveResult> => ({ kind: "reserved", sessionId: input.sessionId }),
  });
  const session = Object.create(ChatSession.prototype);
  const runtime: ChatRuntime = {
    registry,
    scheduleManager: Object.create(ChatScheduleManager.prototype),
    wireSession: () => {},
    maintenance: Promise.resolve(),
    resolveSendTarget: async (args: SendTargetArgs): Promise<SendTargetResult> => ({ ok: true, target: { session, id: args.sessionParam === "new" ? null : args.sessionParam } }),
    sendUserMessage: async (args: UserMessageSendArgs): Promise<SendOutcome> => {
      sends.push(args.message);
      if (claimed.has(args.messageId)) return { status: 200, body: { deduplicated: true } };
      claimed.add(args.messageId);
      return { status: 200, body: { turnId: "turn-1" } };
    },
  };
  setChatRuntime(boxRoot, runtime);
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

/** The card path for a send: the card name carries the send's id. */
function cardPath(id: string) {
  return `_content/incoming/Raised_beds_on_a_slope-${id}.webpage.card`;
}

const GARDEN_CHOICES = [
  { candidateId: "c0", label: "New chat in Garden" },
  { candidateId: "c1", label: "New general chat" },
];

const PAGE_VIEW = { title: "Raised beds on a slope", url: "https://example.com/beds" };

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

// ## A page with a note posts to the chat Jev picks, and the card stays out of git
//
// The card is written to `_content/incoming/` with its frozen snapshot, and the
// folder's own `.gitignore` keeps both out of `git status`. The delivered message
// holds the note and the card reference; the page title is not in it. Jev sees
// the page as data beside the note.
void test("The card is written to content/incoming/ with its frozen snapshot, and the fo...", async (t) => {
  const box = await gardenBox();
  const sends = scriptedRuntime(box.root);
  const jev = clear();
  const id = randomUUID();
  const base = `Raised_beds_on_a_slope-${id}`;
  const delivered = `<external-input source="browser-clerk" source-ref="_content/incoming/${base}.webpage.card">for the slope out back</external-input>`;
  const result = await caller(box.root, jev).clerk.send(page(id, { note: "for the slope out back" }));
  const card = result.card;
  t.check(
    ({ result, incoming: await incoming(box), gitStatus: gitStatus(box), sends,
      jevState: decisionState(jev) }),
    {
    result: {
      card: `_content/incoming/${base}.webpage.card`,
      state: "sent",
      destination: {
        label: "New chat in Garden",
        sessionId: uuid(),
      },
    },
    incoming: [
      ".gitignore",
      ".gitkeep",
      `${base}.attach`,
      `${base}.webpage.card`,
    ],
    gitStatus: "",
    sends: [delivered],
    jevState: {
      message: "for the slope out back",
      page: {
        title: "Raised beds on a slope",
        url: "https://example.com/beds",
        site: "Example Gardens",
      },
    },
  },
  );

  // The card carries the send's id as `capture-id`, and the frozen page sits in its
  // attach folder.

  const text = await readFile(path.join(box.root, card), "utf8");
  t.check(
    ({ captureId: text.match(/capture-id: (.*)/)?.[1] === id, body: text.slice(text.lastIndexOf("---") + 3).trim(),
      frozen: await readFile(path.join(box.root, card.replace(".webpage.card", ".attach/page.frozen")), "utf8") }),
    {
    captureId: true,
    body: `# Raised beds

Terrace them.`,
    frozen: "<html><body>frozen</body></html>",
  },
  );

  // ## A repeat of the same send writes nothing new
  //
  // A lost response makes the Clerk send the same payload again. The box answers
  // from the stored send: one card, one delivery.

  const again = await caller(box.root, jev).clerk.send(page(id, { note: "for the slope out back" }));
  t.check({ again, cards: (await incoming(box)).filter((name) => name.endsWith(".webpage.card")), sends }, {
    again: result,
    cards: [`${base}.webpage.card`],
    sends: [delivered],
  });

  // ## Filing the card with `bbx mv --commit`, then a late repeat
  //
  // The chat's agent files the card. `bbx mv --commit` stages only paths git can
  // take: the card's old path was never tracked. The commit holds the card and its
  // frozen page. A repeat of the send after that still writes no card: the stored
  // send answers, naming the path it was delivered with.

  const { ctx } = createCollectorContext(box.root);
  const moved = await executeMove(ctx, { from: card, to: "_content/Garden/", commit: true });
  const committed = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: box.root, encoding: "utf8" }).trim().split("\n");
  const late = await caller(box.root, jev).clerk.send(page(id, { note: "for the slope out back" }));
  t.check(({ moved, committed, gitStatus: gitStatus(box), late, incomingCards: (await incoming(box)).filter((name) => name.endsWith(".webpage.card")) }), {
    moved: {
      success: true,
      data: {
        from: `_content/incoming/${base}.webpage.card`,
        to: `_content/Garden/${base}.webpage.card`,
        movedFiles: [
          { from: `_content/incoming/${base}.webpage.card`, to: `_content/Garden/${base}.webpage.card` },
          { from: `_content/incoming/${base}.attach`, to: `_content/Garden/${base}.attach` },
        ],
        updatedCards: [],
        filesToStage: [
          `_content/incoming/${base}.webpage.card`,
          `_content/Garden/${base}.webpage.card`,
          `_content/incoming/${base}.attach`,
          `_content/Garden/${base}.attach`,
        ],
      },
    },
    committed: [
      `_content/Garden/${base}.attach/page.frozen`,
      `_content/Garden/${base}.webpage.card`,
    ],
    gitStatus: "",
    late: result,
    incomingCards: [],
  });

  // Moving the filed card again, now that git tracks it, commits both files as
  // renames, with no old path left behind: a moved directory counts as tracked
  // when any file under it is.

  const filed = `_content/Garden/${card.split("/").at(-1)}`;
  const again2 = await executeMove(createCollectorContext(box.root).ctx, { from: filed, to: "_content/Reading/", commit: true });
  const changed = execFileSync("git", ["show", "--name-status", "--format=", "HEAD"], { cwd: box.root, encoding: "utf8" }).trim().split("\n");
  t.check(({ moved: again2, changed, gitStatus: gitStatus(box) }), {
    moved: {
      success: true,
      data: {
        from: `_content/Garden/${base}.webpage.card`,
        to: `_content/Reading/${base}.webpage.card`,
        movedFiles: [
          { from: `_content/Garden/${base}.webpage.card`, to: `_content/Reading/${base}.webpage.card` },
          { from: `_content/Garden/${base}.attach`, to: `_content/Reading/${base}.attach` },
        ],
        updatedCards: [],
        filesToStage: [
          `_content/Garden/${base}.webpage.card`,
          `_content/Reading/${base}.webpage.card`,
          `_content/Garden/${base}.attach`,
          `_content/Reading/${base}.attach`,
        ],
      },
    },
    changed: [
      `R100\t_content/Garden/${base}.attach/page.frozen\t_content/Reading/${base}.attach/page.frozen`,
      `R100\t_content/Garden/${base}.webpage.card\t_content/Reading/${base}.webpage.card`,
    ],
    gitStatus: "",
  });

  // ## The same id with a different page or note is refused

  t.check(
    [await failure(() => caller(box.root, jev).clerk.send(page(id, { note: "for the slope out back", url: "https://example.com/other" }))),
      await failure(() => caller(box.root, jev).clerk.send(page(id, { note: "different words" })))],
    [
    "CONFLICT: This send already holds a different page or note. Send it again as a new send.",
    "CONFLICT: This send already holds a different page or note. Send it again as a new send.",
  ],
  );
});

// ## A page with no note that Jev cannot place waits for a choice
//
// The view carries the page so the box screen can label the row; the message is
// empty.
void test("The view carries the page so the box screen can label the row; the message is...", async (t) => {
  const box = await gardenBox();
  scriptedRuntime(box.root);
  const id = randomUUID();
  const result = await caller(box.root, unsure()).clerk.send(page(id));
  const row = (await caller(box.root, unsure()).quickChat.home()).open[0];
  t.check({ result, row }, {
    result: { card: cardPath(id), state: "needs-choice", reason: "uncertain", choices: GARDEN_CHOICES },
    row: { id, message: "", createdAt: isoDate(), state: "needs-choice", reason: "uncertain", choices: GARDEN_CHOICES, page: PAGE_VIEW },
  });

  // ## A card filed before the choice is delivered from where it is now
  //
  // Someone files the waiting card from Browse, renaming it. Choosing a
  // destination delivers the card's current path, found by its `capture-id`.

  const sends = scriptedRuntime(box.root);
  const { ctx } = createCollectorContext(box.root);
  await executeMove(ctx, { from: result.card, to: "_content/Garden/Beds.webpage.card", commit: true });
  const chosen = await caller(box.root, unsure()).quickChat.choose({ id, candidateId: "c0" });
  t.check({ chosen, sends }, {
    chosen: {
      id,
      message: "",
      createdAt: isoDate(),
      state: "sent",
      destination: { label: "New chat in Garden", sessionId: uuid() },
      page: PAGE_VIEW,
    },
    sends: [
      "<external-input source=\"browser-clerk\" source-ref=\"_content/Garden/Beds.webpage.card\"></external-input>",
    ],
  });
});

// ## A card removed before the choice is not delivered
void test("A card removed before the choice is not delivered", async (t) => {
  const box = await gardenBox();
  const sends = scriptedRuntime(box.root);
  const id = randomUUID();
  const result = await caller(box.root, unsure()).clerk.send(page(id));
  await unlink(path.join(box.root, result.card));
  const chosen = await caller(box.root, unsure()).quickChat.choose({ id, candidateId: "c0" });
  t.check({ chosen, sends }, {
    chosen: {
      id,
      message: "",
      createdAt: isoDate(),
      state: "sending",
      destination: { label: "New chat in Garden", sessionId: uuid() },
      lastError: "The sent page was removed.",
      page: PAGE_VIEW,
    },
    sends: [],
  });
});

// ## Two sends with the same title get two cards
void test("Two sends with the same title get two cards", async (t) => {
  const box = await gardenBox();
  scriptedRuntime(box.root);
  const [first, second] = [randomUUID(), randomUUID()];
  await caller(box.root, clear()).clerk.send(page(first));
  await caller(box.root, clear()).clerk.send(page(second));
  t.check((await incoming(box)).filter((name) => name.endsWith(".webpage.card")), [
    `Raised_beds_on_a_slope-${first}.webpage.card`,
    `Raised_beds_on_a_slope-${second}.webpage.card`,
  ].toSorted());
});

// ## A card saved before the box stopped is routed on the next attempt
//
// The box can stop after writing the card and before storing the send. The
// Clerk's repeat finds the card by its id and routes it; no second card.
void test("The box can stop after writing the card and before storing the send.", async (t) => {
  const box = await gardenBox();
  const sends = scriptedRuntime(box.root);
  const id = randomUUID();
  await caller(box.root, clear()).clerk.send(page(id, { note: "keep" }));
  await rm(path.join(box.root, ".beebox/quick-chat", `${id}.json`), { force: true });
  sends.length = 0;
  const result = await caller(box.root, clear()).clerk.send(page(id, { note: "keep" }));
  t.check({ result, cards: (await incoming(box)).filter((name) => name.endsWith(".webpage.card")) }, {
    result: { card: cardPath(id), state: "sent", destination: { label: "New chat in Garden", sessionId: uuid() } },
    cards: [`Raised_beds_on_a_slope-${id}.webpage.card`],
  });
});

// ## Without a routing key, the page waits with recent chats to choose from
void test("Without a routing key, the page waits with recent chats to choose from", async (t) => {
  const box = await gardenBox();
  scriptedRuntime(box.root);
  const id = randomUUID();
  const result = await caller(box.root, undefined).clerk.send(page(id, { note: "later" }));
  t.check(result, {
    card: cardPath(id),
    state: "needs-choice",
    reason: "routing-unavailable",
    choices: [{ candidateId: "c1", label: "New general chat" }],
  });
});
