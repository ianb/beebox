// # Actions API
//
// The actions API handles one raw-Fastify mutation — creating a card from a
// template. (Answering and dismissing questions moved to the tRPC
// `actions.answer`/`actions.dismiss` mutations — see `trpc-actions.doctest.md`;
// the raw `/api/actions/answer` duplicate was removed.)

import { test } from "tap";
import "agent-doctest/tap";
import { makeTestServer } from "../../helpers/doctest-server.js";
import { bodyField } from "../../helpers/doctest-helpers.js";

// ## Creating a card
//
// `POST /api/actions/create` creates a card from a template:
void test("POST /api/actions/create creates a card from a template:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L18
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/actions/create",
    payload: {
      path: "_content/inbox/new.doc.card",
      template: "doc",
      args: { title: "From the API", body: "Hello from the API" },
    },
  });
  t.check(res.statusCode, 200);

  // doctest:L33
  t.check(bodyField(res.body, "success"), true);

  // doctest:L36
  t.check(bodyField(res.body, "path"), "_content/inbox/new.doc.card");

  // The card exists on disk:

  // doctest:L43
  const content = await ctx.read("_content/inbox/new.doc.card");
  await t.checkText(content.includes("Hello from the API"), "true");
});

// Missing path returns 400:
void test("Missing path returns 400:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L55
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/actions/create",
    payload: { template: "doc" },
  });
  t.check(res.statusCode, 400);
});

// Missing template returns 400:
void test("Missing template returns 400:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L72
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/actions/create",
    payload: { path: "_content/inbox/test.doc.card" },
  });
  t.check(res.statusCode, 400);
});
