// # Which navigations seed the browse key (`bin/browse open`)
//
// The browse key authenticates this worktree's box and the router's read-only
// dev surfaces. `open` seeds the cookie for exactly those URLs, so a fresh
// profile's first visit to a `/<worktree>/dev/…` page is signed in rather than
// landing on the login page.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { authCookieArgs, isOwnOrigin, seedsBrowseKey, type WorktreeContext } from "../src/worktree.js";

const router: WorktreeContext = { repoDir: "/r", worktree: "wt", box: "test1", port: 3210, routerBase: "http://localhost:3210/wt/test1" };

// ## The shared router: box routes and read-only dev surfaces
//
// Dev pages and the workstreams browser seed the key; they are still not this
// worktree's box page, so page-ready waits keep skipping them. Another
// worktree's dev surface, a look-alike prefix, and another host do not seed.
void test("Dev pages and the workstreams browser seed the key; they are still not this w...", (t) => {
  const verdict = (url: string) => `${seedsBrowseKey(url, router) ? "seeds" : "no-key"}${isOwnOrigin(url, router) ? " box" : ""}`;
  t.check(
    {
      box: verdict("http://localhost:3210/wt/test1/chats"),
      devPage: verdict("http://localhost:3210/wt/dev/canvas-loop-pages/pieces.html"),
      devRoot: verdict("http://localhost:3210/wt/dev"),
      workstreams: verdict("http://localhost:3210/workstreams/browse?file=x.md"),
      otherWorktreeDev: verdict("http://localhost:3210/other/dev/x.html"),
      lookalikeDev: verdict("http://localhost:3210/wt/devices"),
      lookalikeWorkstreams: verdict("http://localhost:3210/workstreams-app"),
      control: verdict("http://localhost:3210/__router/status"),
      otherHost: verdict("http://example.com/wt/dev/x.html"),
    },
    {
      box: "seeds box",
      devPage: "seeds",
      devRoot: "seeds",
      workstreams: "seeds",
      otherWorktreeDev: "no-key",
      lookalikeDev: "no-key",
      lookalikeWorkstreams: "no-key",
      control: "no-key",
      otherHost: "no-key",
    },
  );
  t.end();
});

// ## The cookie for a dev page is the same router-wide cookie
//
// Seeding from a dev URL sets the same host-scoped cookie a box URL does, and a
// URL the key does not cover is refused.
void test("Seeding from a dev URL sets the same host-scoped cookie a box URL does, and a...", (t) => {
  const prior = process.env["BBX_BROWSE_API_KEY"];
  process.env["BBX_BROWSE_API_KEY"] = "k";
  t.teardown(() => {
    if (prior === undefined) delete process.env["BBX_BROWSE_API_KEY"];
    else process.env["BBX_BROWSE_API_KEY"] = prior;
  });
  const fromDev = authCookieArgs("http://localhost:3210/wt/dev/x.html", router);
  const fromBox = authCookieArgs("http://localhost:3210/wt/test1/", router);
  let refusal = "(no error)";
  try {
    authCookieArgs("http://example.com/wt/dev/x.html", router);
  } catch (e) {
    refusal = e instanceof Error ? e.message : String(e);
  }
  t.check(
    { sameExceptExpiry: fromDev.slice(0, -1).join(" ") === fromBox.slice(0, -1).join(" "), origin: fromDev[fromDev.indexOf("--url") + 1], refusal },
    { sameExceptExpiry: true, origin: "http://localhost:3210", refusal: "Refusing to seed browse auth for another origin: http://example.com/wt/dev/x.html" },
  );
  t.end();
});

// ## A dedicated server gets the box base alone
//
// With `BROWSE_BASE_URL` pointing at a server that is not the router, there are
// no dev surfaces to grant.
void test("With BROWSE_BASE_URL pointing at a server that is not the router, there are n...", (t) => {
  const dedicated: WorktreeContext = { ...router, routerBase: "http://127.0.0.1:5123/test1" };
  t.check(
    {
      box: seedsBrowseKey("http://127.0.0.1:5123/test1/chats", dedicated),
      dev: seedsBrowseKey("http://127.0.0.1:5123/wt/dev/x.html", dedicated),
      workstreams: seedsBrowseKey("http://127.0.0.1:5123/workstreams/browse", dedicated),
    },
    { box: true, dev: false, workstreams: false },
  );
  t.end();
});
