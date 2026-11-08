// Box paths in `bbx browser`: a `/path` on `open` (and its aliases) or
// `tab new` becomes this box's page URL; every other argument is untouched.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { resolveBoxPaths } from "../../../../src/core/browser/agent-command/box-path.js";

const DEV = { app: { ok: true as const, base: new URL("http://localhost:3210/wt") }, slug: "test1" };
const PROD = { app: { ok: true as const, base: new URL("https://box.example.com") }, slug: "home" };

void test("a box path names a page of this box; full URLs and other commands pass unchanged", (t) => {
  t.check(
    {
      dev: resolveBoxPaths(["open", "/views/_content/a.card"], DEV),
      prod: resolveBoxPaths(["goto", "/views/_content/a.card?view=table"], PROD),
      withFlag: resolveBoxPaths(["--json", "navigate", "/chats"], PROD),
      tabNew: resolveBoxPaths(["tab", "new", "--label", "card", "/views/a.md"], PROD),
      fullUrl: resolveBoxPaths(["open", "https://example.com/x"], PROD),
      click: resolveBoxPaths(["click", "/not/an/address"], PROD),
      tabList: resolveBoxPaths(["tab", "list"], PROD),
    },
    {
      dev: { ok: true, args: ["open", "http://localhost:3210/wt/test1/views/_content/a.card"] },
      prod: { ok: true, args: ["goto", "https://box.example.com/home/views/_content/a.card?view=table"] },
      withFlag: { ok: true, args: ["--json", "navigate", "https://box.example.com/home/chats"] },
      tabNew: { ok: true, args: ["tab", "new", "--label", "card", "https://box.example.com/home/views/a.md"] },
      fullUrl: { ok: true, args: ["open", "https://example.com/x"] },
      click: { ok: true, args: ["click", "/not/an/address"] },
      tabList: { ok: true, args: ["tab", "list"] },
    },
  );
  t.end();
});

void test("another site's protocol-relative URL, or no app URL, is refused with the reason", (t) => {
  t.check(
    {
      otherSite: resolveBoxPaths(["open", "//evil.example.com/x"], PROD),
      noApp: resolveBoxPaths(["open", "/views/a.md"], { app: { ok: false, reason: "this box has no public URL, so its browser cannot open the box's pages" }, slug: "home" }),
    },
    {
      otherSite: { ok: false, message: "bbx browser: //evil.example.com/x names another site; a page of this box starts with one /, such as /views/<card path>" },
      noApp: { ok: false, message: "bbx browser: cannot open /views/a.md: this box has no public URL, so its browser cannot open the box's pages" },
    },
  );
  t.end();
});
