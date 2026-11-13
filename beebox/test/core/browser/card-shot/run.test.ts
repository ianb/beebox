// `screenshot --card` without a browser: which page URLs name a card, and the
// order of commands (measure, grow the viewport, measure, capture, restore)
// against a scripted sender.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecReply } from "../../../../src/core/browser/command-socket.js";
import { captureCard, cardPanelId, cardPathFromUrl } from "../../../../src/core/browser/card-shot/run.js";

const DEV = { base: new URL("http://localhost:3210/wt"), slug: "test1" };

void test("a card is named by /views/<path> or /chat?card=<path> on this box only", (t) => {
  t.check(
    {
      views: cardPathFromUrl("http://localhost:3210/wt/test1/views/_content/recipes/Beef%20Stew.recipe.card?view=table", DEV),
      chat: cardPathFromUrl("http://localhost:3210/wt/test1/chat?card=_content%2Frecipes%2FStew.recipe.card&session=x", DEV),
      chatWithViewParams: cardPathFromUrl(
        `http://localhost:3210/wt/test1/chat?card=${encodeURIComponent("_content/chem/Periodic_Table.chem.card?select=O&view=table")}`,
        DEV,
      ),
      chatNoCard: cardPathFromUrl("http://localhost:3210/wt/test1/chat?session=x", DEV),
      otherBox: cardPathFromUrl("http://localhost:3210/wt/other/views/_content/a.card", DEV),
      otherSite: cardPathFromUrl("https://example.com/wt/test1/views/a.card", DEV),
      blank: cardPathFromUrl("about:blank", DEV),
    },
    {
      views: "_content/recipes/Beef Stew.recipe.card",
      chat: "_content/recipes/Stew.recipe.card",
      chatWithViewParams: "_content/chem/Periodic_Table.chem.card",
      chatNoCard: null,
      otherBox: null,
      otherSite: null,
      blank: null,
    },
  );
  t.end();
});

function evalReply(measure: object): ExecReply {
  return { exitCode: 0, stdout: JSON.stringify(JSON.stringify(measure)), stderr: "" };
}

void test("a card taller than its panel: grow, measure, capture, restore", async (t) => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "card-shot-"));
  t.teardown(() => fs.rm(outDir, { recursive: true, force: true }));
  const base = { found: true, url: "http://localhost:3210/wt/test1/views/a.card", card: { width: 366, height: 2027 }, viewport: { width: 390, height: 844 }, dpr: 1, overflow: [], scrolls: [], errorText: null, busy: false };
  const measures = [evalReply({ ...base, painted: { x: 0, y: 0, width: 366, height: 671 } }), evalReply({ ...base, painted: { x: 0, y: 0, width: 366, height: 2027 } })];
  const sent: string[][] = [];
  const io = {
    send: (args: readonly string[]): Promise<ExecReply> => {
      sent.push([...args]);
      return Promise.resolve({ exitCode: 0, stdout: args[0] === "get" ? "http://localhost:3210/wt/test1/views/a.card\n" : "✓ Done", stderr: "" });
    },
    sendFull: (args: readonly string[]): Promise<ExecReply> => {
      sent.push([args[0] ?? ""]);
      return Promise.resolve(measures.shift() ?? { exitCode: 1, stdout: "", stderr: "no more" });
    },
  };
  const result = await captureCard(io, { ...DEV, outDir, now: new Date("2026-11-08T17:53:01.250Z") });
  t.check(sent, [
    ["get", "url"],
    ["wait", "--fn", any(String), "--timeout", "15000"],
    ["eval"],
    // 844 + (2027 - 671) missing + 40 margin.
    ["set", "viewport", "390", "2240"],
    ["eval"],
    ["screenshot", `#${cardPanelId("a.card")} > article`, path.join(outDir, "card-a.card-390px-20261108-175301.png")],
    ["set", "viewport", "390", "844"],
  ]);
  t.check(result.ok ? result.output : result.message, `✓ Screenshot saved to ${path.join(outDir, "card-a.card-390px-20261108-175301.png")}\ncard: a.card at 390px wide — whole card (366×2027)\n`);
});

void test("a page with no card says how to open one", async (t) => {
  const io = {
    send: (): Promise<ExecReply> => Promise.resolve({ exitCode: 0, stdout: "https://example.com/\n", stderr: "" }),
    sendFull: (): Promise<ExecReply> => Promise.resolve({ exitCode: 1, stdout: "", stderr: "" }),
  };
  t.check(await captureCard(io, { ...DEV, outDir: "/nonexistent", now: new Date(0) }), {
    ok: false,
    message: "bbx browser: --card works on this box's card pages; the browser is on https://example.com/. Open one with bbx browser open /views/<card path>",
  });
});
