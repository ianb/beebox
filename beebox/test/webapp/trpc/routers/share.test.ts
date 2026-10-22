// # iOS share-sheet tRPC contract
//
// The native Share Extension gets a small destination list and can save URL or
// plain-text values without going through a chat. Saved URLs use the same webpage
// card type and fallback body as Clerk.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { shareDestinationsOutput } from "../../../../src/webapp/trpc/routers/share/contract.js";

function caller(boxRoot: string) {
  return appRouter.createCaller(trpcContext({ boxRoot, isOwner: false, actor: "none" }));
}

// The TypeScript contract accepts the same non-batched tRPC envelope fixture that
// the native XCTest decodes:
void test("The TypeScript contract accepts the same non-batched tRPC envelope fixture th...", async (t) => {
  const fixture = JSON.parse(await readFile("test/mobile-contract/fixtures/share-destinations.json", "utf-8"));
  t.check(shareDestinationsOutput.parse(fixture.result.data), {
    chats: [
      {
        sessionId: "session-reading",
        label: "Article ideas",
        lastActivity: "2026-08-07T12:00:00.000Z",
        landmark: { dir: "_content/reading", label: "Reading", symbol: "📚" },
      },
    ],
    saves: [
      { destination: { kind: "inbox" }, label: "Inbox", symbol: null },
      { destination: { kind: "landmark", dir: "_content/reading" }, label: "Reading", symbol: "📚" },
    ],
  });
});

// ## Destinations include Inbox and only landmarks advertising share
void test("Destinations include Inbox and only landmarks advertising share", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await mkdir(path.join(box.root, "_content/reading"), { recursive: true });
  await writeFile(path.join(box.root, "_content/reading/Reading.landmark.card"), `---
symbol:
  glyph: 📚
navigation:
  label: Reading
destinations:
  - for: [share]
---
`, "utf-8");
  await mkdir(path.join(box.root, "_content/private"), { recursive: true });
  await writeFile(path.join(box.root, "_content/private/Private.landmark.card"), `---
navigation:
  label: Private
destinations:
  - for: [triage]
---
`, "utf-8");
  const destinations = await caller(box.root).share.destinations();
  t.check(destinations.saves, [
    { destination: { kind: "inbox" }, label: "Inbox", symbol: null },
    { destination: { kind: "landmark", dir: "_content/reading" }, label: "Reading", symbol: "📚" },
  ]);
  t.check(destinations.chats, []);

  // ## URL saves are Clerk-compatible and idempotent after a move

  const request = {
    kind: "url" as const,
    shareId: "00000000-0000-4000-8000-000000000001",
    url: "https://example.com/article",
    title: "An Example",
    capturedAt: "2026-08-07T12:00:00.000Z",
    destination: { kind: "landmark" as const, dir: "_content/reading" },
  };
  const first = await caller(box.root).share.saveTextual(request);
  const [firstCreated] = first.created;
  assert.ok(firstCreated, "the save created a card");
  const saved = await readFile(path.join(box.root, firstCreated), "utf-8");
  t.check(first, { created: ["_content/reading/An_Example_00000000-0000-4000-8000-000000000001.webpage.card"] });
  t.checkText(saved, `---
title: An Example
sources:
  - href: https://example.com/article
    retrieved: 2026-08-07T12:00:00.000Z
share-id: 00000000-0000-4000-8000-000000000001
---
[An Example](https://example.com/article)`);

  const moved = path.join("_content/inbox", path.basename(firstCreated));
  await mkdir(path.join(box.root, "_content/inbox"), { recursive: true });
  await rename(path.join(box.root, firstCreated), path.join(box.root, moved));
  const replay = await caller(box.root).share.saveTextual(request);
  t.check(replay, { created: ["_content/inbox/An_Example_00000000-0000-4000-8000-000000000001.webpage.card"] });

  // ## A retry finds a card written in the migrated `sources` shape
  //
  // Boxes carry cards that the retired `source-fields-2026-09` migration rewrote
  // from the old `source`/`captured` keys. The router compares an existing card
  // with the text it would generate byte for byte, so this fixture pins that shape:
  // a retry of such a share finds the card instead of reporting a conflict.

  const oldRequest = { ...request, shareId: "00000000-0000-4000-8000-000000000003", title: "Before" };
  const oldRel = "_content/inbox/Before_00000000-0000-4000-8000-000000000003.webpage.card";
  const migratedCard = [
    "---",
    "title: Before",
    "sources:",
    "  - href: https://example.com/article",
    "    retrieved: 2026-08-07T12:00:00.000Z",
    "share-id: 00000000-0000-4000-8000-000000000003",
    "---",
    "[Before](https://example.com/article)",
    "",
  ].join("\n");
  await writeFile(path.join(box.root, oldRel), migratedCard, "utf-8");
  t.check(await caller(box.root).share.saveTextual(oldRequest), { created: [oldRel] });

  // ## A reused share id with different immutable content conflicts

  const conflict = await caller(box.root).share.saveTextual({
    ...request,
    url: "https://different.example/",
  }).then(() => "no-error", (error) => error.code);
  t.check(conflict, "CONFLICT");

  // ## A stale landmark selection is rejected instead of becoming Inbox

  const stale = await caller(box.root).share.saveTextual({
    kind: "text",
    shareId: "00000000-0000-4000-8000-000000000002",
    text: "Keep this exact text",
    capturedAt: "2026-08-07T12:00:00.000Z",
    destination: { kind: "landmark", dir: "_content/missing" },
  }).then(() => "no-error", (error) => error.code);
  t.check(stale, "BAD_REQUEST");
});
