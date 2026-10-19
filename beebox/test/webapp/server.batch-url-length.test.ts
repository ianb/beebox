// # A long tRPC batch routes
//
// A batched GET names every procedure in its URL path, and the server routes
// that list as one Fastify parameter. The client splits a batch only past
// `TRPC_MAX_URL_LENGTH`, so the server must route any procedure list up to that
// length. At a smaller server limit, a page that refreshed many queries at once
// got `404 {"error":"Not found"}` for the whole batch.

import assert from "node:assert";
import { test } from "tap";
import "agent-doctest/tap";
import { any } from "agent-doctest/check";
import { makeTestServer } from "../helpers/test-route-server.js";
import { TRPC_MAX_URL_LENGTH } from "../../src/shared/trpc-url-limit.js";

const box = await makeTestServer();

// A batch of `health.check` calls whose procedure list is just under the
// client's URL limit routes and answers every call.
void test("A batch of health.check calls whose procedure list is just under the client's...", async (t) => {
  // doctest:L20
  const names = [];
  while ((names.length + 1) * "health.check,".length < TRPC_MAX_URL_LENGTH - 100) names.push("health.check");
  const list = names.join(",");
  t.check(list, any(String).matches(/^health\.check(,health\.check){115,}$/));

  // doctest:L26
  const res = await box.request({ method: "GET", url: `/api/trpc/${list}?batch=1&input=%7B%7D` });
  // The health payload depends on the host (git-annex version, check status), so each
  // entry is checked only to be a result (not an error) with its status, checks and version.
  assert(Array.isArray(res.body));
  t.check(
    { status: res.statusCode, entries: res.body.map((entry: { result?: { data?: { checks?: unknown[] } } }) => Object.keys(entry.result?.data ?? {})) },
    { status: 200, entries: names.map(() => ["status", "checks", "version"]) },
  );

  // doctest:L30
  await box.cleanup();
});
