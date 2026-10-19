// # Package exports — the public library surface
//
// The `exports` map in package.json is the API boundary: box-authored code
// (schemas, views, tricks) may import only these specifiers. This doctest
// imports each one **the way box code does** — via the bare `beebox/…`
// specifier (package self-reference), not relative paths — so a broken export
// target fails here before it fails in a real box.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, containing } from "@ianbicking/tap-check/check";
import { cardSchema, body, splitCardContent } from "beebox/cards";
import { z, parseYaml, stringifyYaml } from "beebox/schema";
import * as server from "beebox/server";

// ## beebox/cards — card primitives
//
// A box-local schema file's whole toolkit: `cardSchema` + `body` (plus `z` from
// `beebox/schema`, below).
void test("A box-local schema file's whole toolkit:", async (t) => {
  const demo = cardSchema("demo", {
    fields: { status: z.enum(["new", "done"]), body: body(z.string()) },
  });
  t.check(demo.type, "demo");

  t.check(Object.keys(demo.fields).toSorted(), ["body", "status"]);

  t.check(splitCardContent("---\nstatus: new\n---\nHello.").body.trim(), "Hello.");
});

// ## beebox/schema — validator deps, pinned to the engine's versions
void test("beebox/schema — validator deps, pinned to the engine's versions", async (t) => {
  t.check(z.string().parse("ok"), "ok");

  t.check(stringifyYaml({ a: 1 }).trim(), "a: 1");

  t.check(parseYaml("a: 1"), {
    a: 1,
  });
});

// ## beebox/server — programmatic entry, no side effects on import
//
// Importing the module must not start anything; it only exposes the functions
// and the port constant.
void test("Importing the module must not start anything; it only exposes the functions a...", async (t) => {
  t.check(typeof server.createServer, "function");

  t.check(typeof server.startServer, "function");

  t.check(server.DEFAULT_PORT, 3210);
});

// ## beebox/view-widgets and the box tsconfig base
//
// `view-widgets` is React-flavored, so we import it dynamically and just verify
// the exports resolve. The tsconfig base resolves as an exported JSON path.
void test("view-widgets is React-flavored, so we import it dynamically and just verify t...", async (t) => {
  const widgets = await import("beebox/view-widgets");
  t.check(Object.keys(widgets), containing(["CardLink", "CardRef", "Markdown", "NodeViewHostProvider"]));

  t.check(import.meta.resolve("beebox/tsconfig.base.json"), any(String).endsWith("/tsconfig.base.json"));
});
