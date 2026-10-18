// # Package exports — the public library surface
//
// The `exports` map in package.json is the API boundary: box-authored code
// (schemas, views, tricks) may import only these specifiers. This doctest
// imports each one **the way box code does** — via the bare `beebox/…`
// specifier (package self-reference), not relative paths — so a broken export
// target fails here before it fails in a real box.

import { test } from "tap";
import "agent-doctest/tap";
import { cardSchema, body, splitCardContent } from "beebox/cards";
import { z, parseYaml, stringifyYaml } from "beebox/schema";
import * as server from "beebox/server";

// ## beebox/cards — card primitives
//
// A box-local schema file's whole toolkit: `cardSchema` + `body` (plus `z` from
// `beebox/schema`, below).
void test("A box-local schema file's whole toolkit:", async (t) => {
  // doctest:L21
  const demo = cardSchema("demo", {
    fields: { status: z.enum(["new", "done"]), body: body(z.string()) },
  });
  t.check(demo.type, "demo");

  // doctest:L27
  t.check(Object.keys(demo.fields).toSorted().join(","), "body,status");

  // doctest:L30
  t.check(splitCardContent("---\nstatus: new\n---\nHello.").body.trim(), "Hello.");
});

// ## beebox/schema — validator deps, pinned to the engine's versions
void test("beebox/schema — validator deps, pinned to the engine's versions", async (t) => {
  // doctest:L37
  t.check(z.string().parse("ok"), "ok");

  // doctest:L40
  t.check(stringifyYaml({ a: 1 }).trim(), "a: 1");

  // doctest:L43
  t.check(parseYaml("a: 1"), {
    a: 1,
  });
});

// ## beebox/server — programmatic entry, no side effects on import
//
// Importing the module must not start anything; it only exposes the functions
// and the port constant.
void test("Importing the module must not start anything; it only exposes the functions a...", async (t) => {
  // doctest:L53
  t.check(typeof server.createServer, "function");

  // doctest:L56
  t.check(typeof server.startServer, "function");

  // doctest:L59
  t.check(server.DEFAULT_PORT, 3210);
});

// ## beebox/view-widgets and the box tsconfig base
//
// `view-widgets` is React-flavored, so we import it dynamically and just verify
// the exports resolve. The tsconfig base resolves as an exported JSON path.
void test("view-widgets is React-flavored, so we import it dynamically and just verify t...", async (t) => {
  // doctest:L69
  const widgets = await import("beebox/view-widgets");
  await t.checkText(["CardLink", "CardRef", "Markdown", "NodeViewHostProvider"].every((name) => Object.keys(widgets).includes(name)), "true");

  // doctest:L73
  await t.checkText(import.meta.resolve("beebox/tsconfig.base.json").endsWith("/tsconfig.base.json"), "true");
});
