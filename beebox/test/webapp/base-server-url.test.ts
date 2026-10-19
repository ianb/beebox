// # `baseServerUrl` — server base above the box scope
//
// Strips the trailing box-slug segment from a box's public URL to get the server
// base, which callers concatenate with `/auth/...`, `/webhook/...`, etc. It must
// **never return a trailing slash** — a caller appending `/auth/google-services/callback`
// to a trailing-slash base produced `https://host//auth/...`, which broke Google
// OAuth with a redirect_uri mismatch (the double slash).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { baseServerUrl } from "../../src/webapp/base-server-url.js";

// ## A slug deployment strips the slug, no trailing slash
void test("A slug deployment strips the slug, no trailing slash", async (t) => {
  // doctest:L16
  t.check(
    baseServerUrl("https://box.example.com/ledger")
    ,
    "https://box.example.com",
  );
});

// ## A trailing slash on the input doesn't leak through
void test("A trailing slash on the input doesn't leak through", async (t) => {
  // doctest:L23
  t.check(
    baseServerUrl("https://box.example.com/ledger/")
    ,
    "https://box.example.com",
  );
});

// ## A root deployment (no slug) returns the bare origin
//
// This is the case that surfaced the bug: with no slug segment to strip, the old
// code left the pathname as `/` and returned `https://host/`.
void test("This is the case that surfaced the bug:", async (t) => {
  // doctest:L33
  t.check(
    baseServerUrl("https://bbx.example.org")
    ,
    "https://bbx.example.org",
  );

  // doctest:L36
  t.check(
    baseServerUrl("https://bbx.example.org/")
    ,
    "https://bbx.example.org",
  );
});

// ## A deployment under a path prefix keeps the prefix (only the slug is stripped)
void test("A deployment under a path prefix keeps the prefix (only the slug is stripped)", async (t) => {
  // doctest:L43
  t.check(
    baseServerUrl("https://example.com/apps/ledger")
    ,
    "https://example.com/apps",
  );
});
