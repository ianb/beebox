// # clerk tRPC router
//
// The browser-extension endpoints (formerly raw `/api/clerk/*`) as tRPC
// procedures: list commentary destinations, and capture a page as a
// `.webpage.card` + sibling `.commentary.card`, committed, returning the companion
// `open` URL. Invalid input is rejected by Zod; an unknown destination is a clear
// error rather than a silent misfile.

import { test } from "tap";
import "agent-doctest/tap";
import { any, capture as captureValue, str } from "agent-doctest/check";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import assert from "node:assert/strict";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

// ## commentary captures a page into the inbox and returns the companion URL
void test("commentary captures a page into the inbox and returns the companion URL", async (t) => {
  // doctest:L27
  const box = await makeTmpBox({ git: true });
  const res = await caller(box.root).clerk.commentary({
    url: "https://example.com/article",
    title: "An Example Article",
    readableMarkdown: "# Heading\n\nBody text.",
  });
  const stamp = captureValue(any(String));
  t.check(res, {
    created: [
      str`_content/inbox/An_Example_Article_${stamp}.webpage.card`,
      str`_content/inbox/An_Example_Article_${stamp}.attach/An_Example_Article_${stamp}.commentary.card`,
    ],
    open: str`chat?session=new&contextDir=_content%2Finbox&companion=view%3A_content%2Finbox%2FAn_Example_Article_${stamp}.webpage.card`,
  });

  // ## the webpage card holds the readable body + source provenance

  // doctest:L50
  const webpageRel = res.created.find((p) => p.endsWith(".webpage.card"));
  assert.ok(webpageRel);
  const body = await readFile(path.join(box.root, webpageRel), "utf-8");
  await t.checkText(body, `---
title: An Example Article
sources:
  - href: https://example.com/article
    retrieved: «date»
---
# Heading

Body text.`);

  // ## an unknown destination is rejected

  // doctest:L63
  const err = await caller(box.root).clerk.commentary({
    url: "https://example.com/x",
    title: "X",
    readableMarkdown: "body",
    destinationDir: "_content/does-not-exist",
  }).then(() => "no-error", (e) => e.code);
  t.check(err, "BAD_REQUEST");

  // ## invalid input (bad url) is rejected by Zod

  // doctest:L77
  const err2 = await caller(box.root).clerk.commentary({
    url: "not-a-url",
    title: "X",
    readableMarkdown: "body",
  }).then(() => "no-error", (e) => e.code);
  t.check(err2, "BAD_REQUEST");

  // ## a retried capture replays the first result instead of writing again
  //
  // The extension sends one `captureId` per capture and resends it when it retries
  // a lost response. The retry returns the same paths, and the box holds one
  // webpage card and one commit. Two concurrent attempts with one id also write
  // once. A capture without an id (an older extension) still writes normally.

  // doctest:L95
  const { execFileSync } = await import("node:child_process");
  const commits = () => execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: box.root, encoding: "utf-8" }).trim();
  const webpages = async () => (await readdir(path.join(box.root, "_content/inbox"))).filter((n) => n.endsWith(".webpage.card"));
  const capture = {
    url: "https://example.com/retry",
    title: "Retry Me",
    readableMarkdown: "Retry body.",
    frozenHtml: "<html>frozen</html>",
    captureId: "30000000-0000-4000-8000-000000000000",
  };
  const before = { commits: commits(), webpages: await webpages() };
  const firstCapture = await caller(box.root).clerk.commentary(capture);
  const [retryA, retryB] = await Promise.all([
    caller(box.root).clerk.commentary(capture),
    caller(box.root).clerk.commentary(capture),
  ]);
  const firstPath = firstCapture.created[0];
  assert.ok(firstPath);
  const card = await readFile(path.join(box.root, firstPath), "utf-8");
  t.check(firstCapture.created.map((p) => path.basename(p).replace(/_[\d-]+T[\dT-]+/u, "_<ts>")), [
    "Retry_Me_<ts>.webpage.card",
    "page.frozen",
    "Retry_Me_<ts>.commentary.card",
  ]);
  t.check(retryA, firstCapture);
  t.check(retryB, firstCapture);
  await t.checkText(card, `---
title: Retry Me
sources:
  - href: https://example.com/retry
    retrieved: «date»
frozen:
  ref: attach/page.frozen
capture-id: 30000000-0000-4000-8000-000000000000
---
Retry body.`);
  t.check(await webpages(), [...before.webpages, str`Retry_Me_${any(String)}.webpage.card`]);
  t.check(Number(commits()) - Number(before.commits), 1);

  // ## a retry after a crash between the write and its commit commits the capture
  //
  // The first attempt wrote its cards but died before committing. The retry finds
  // them by `capture-id`, commits them, and acknowledges the capture; git is the
  // state, so a replied capture is a committed one.

  // doctest:L134
  const crashed = {
    url: "https://example.com/crashed",
    title: "Crashed Once",
    readableMarkdown: "Crashed body.",
    captureId: "40000000-0000-4000-8000-000000000000",
  };
  await writeFile(
    path.join(box.root, "_content/inbox/Crashed_Once_2026-09-30T00-00-00.webpage.card"),
    `---\ntitle: Crashed Once\nsources:\n  - href: https://example.com/crashed\n    retrieved: 2026-09-30T00:00:00.000Z\ncapture-id: ${crashed.captureId}\n---\nCrashed body.\n`,
  );
  const uncommittedBefore = commits();
  const recovered = await caller(box.root).clerk.commentary(crashed);
  t.check(recovered, {
    created: ["_content/inbox/Crashed_Once_2026-09-30T00-00-00.webpage.card"],
    open: "chat?session=new&contextDir=_content%2Finbox&companion=view%3A_content%2Finbox%2FCrashed_Once_2026-09-30T00-00-00.webpage.card",
  });
  t.check(Number(commits()) - Number(uncommittedBefore), 1);
  t.check((await readdir(path.join(box.root, "_content/inbox"))).filter((n) => n.startsWith("Crashed_Once")), ["Crashed_Once_2026-09-30T00-00-00.webpage.card"]);

  // ## a capture ID reused for a different page is a conflict

  // doctest:L158
  const reused = await caller(box.root).clerk.commentary({ ...capture, url: "https://example.com/other" })
    .then(() => "no-error", (e) => e.code);
  t.check(reused, "CONFLICT");

  // ## tab arrangements are created once and retries are idempotent

  // doctest:L168
  const transferId = "00000000-0000-4000-8000-000000000000";
  const windowId = "10000000-0000-4000-8000-000000000000";
  const tabId = "20000000-0000-4000-8000-000000000000";
  const arrangement = {
    transferId,
    scope: "current-window" as const,
    capturedAt: "2026-08-04T12:00:00.000Z",
    source: { windows: [{ id: windowId, tabs: [{ id: tabId, title: "Example", url: "https://example.com", pinned: false }] }] },
    proposal: { windows: [{ id: windowId, tabs: [tabId] }], close: [] },
  };
  const first = await caller(box.root).clerk.tabArrangement(arrangement);
  const retry = await caller(box.root).clerk.tabArrangement(arrangement);
  const saved = await readFile(path.join(box.root, first.card), "utf-8");
  t.check(retry, first);
  t.check(first, {
    card: `_content/inbox/Tabs_${transferId}.tab-arrangement.card`,
    open: `chat?session=new&contextDir=_content%2Finbox&companion=view%3A_content%2Finbox%2FTabs_${transferId}.tab-arrangement.card`,
    transferId,
  });
  await t.checkText(saved, `---
transfer-id: ${transferId}
scope: current-window
captured-at: 2026-08-04T12:00:00.000Z
captured-tabs:
  windows:
    - id: ${windowId}
      tabs:
        - id: ${tabId}
          title: Example
          url: https://example.com
          pinned: false
proposal:
  windows:
    - id: ${windowId}
      tabs:
        - ${tabId}
  close: []
---

Captured by Bee Box Clerk. Revise the proposal with the boxholder before applying.`);

  // ## a transfer ID cannot be retried with a different source snapshot

  // doctest:L195
  const conflict = await caller(box.root).clerk.tabArrangement({
    ...arrangement,
    source: { windows: [{ id: windowId, tabs: [{ id: tabId, title: "Changed", url: "https://changed.example", pinned: false }] }] },
  }).then(() => "no-error", (e) => e.code);
  t.check(conflict, "CONFLICT");
});

// ## commentaryDestinations lists commentary spots and passes the output schema
//
// The query carries a Zod `.output(commentaryDestinationsOutput)` — a real box
// response (including a `symbol: null` landmark) must satisfy it, otherwise tRPC
// throws before returning. Seed one landmark with a symbol and one without, then
// list.
void test("The query carries a Zod .output(commentaryDestinationsOutput) — a real box re...", async (t) => {
  t.teardown(async () => {
    try {
      await dbox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L212
  const dbox = await makeTmpBox({ git: true });
  async function seedLandmark(dir: string, cardBody: string) {
    await mkdir(path.join(dbox.root, dir), { recursive: true });
    await writeFile(path.join(dbox.root, dir, `${path.basename(dir)}.landmark.card`), cardBody, "utf-8");
  }
  await seedLandmark("_content/reading", `---
symbol:
  glyph: 📚
navigation:
  label: Reading
destinations:
  - for: [commentary]
    rules: Reading list.
---
`);
  await seedLandmark("_content/notes", `---
navigation:
  label: Notes
destinations:
  - for: [commentary]
    rules: Loose notes.
---
`);
  const dest = await caller(dbox.root).clerk.commentaryDestinations();
  t.check(dest, {
    destinations: [
      { dir: "_content/notes", label: "Notes", symbol: null },
      { dir: "_content/reading", label: "Reading", symbol: "📚" },
    ],
  });
});
