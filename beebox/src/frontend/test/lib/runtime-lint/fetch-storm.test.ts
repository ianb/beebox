// Runtime lint `fetch-storm`: one request (procedure and input) starting more
// than 8 times in 10 s is reported, counted at the tRPC link above the retry
// link, so a transport retry does not count. Plan: docs/plans/runtime-lint.md,
// Track 2.
// First, and bare: the page buffer lives on the happy-dom window.
import "../../helpers/dom-globals.js";
import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { createTRPCUntypedClient, retryLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { countRequestStart, resetFetchStormForTest, runtimeLintLink } from "../../../src/lib/runtime-lint/fetch-storm.js";
import { formatRecord, resetRuntimeLintForTest } from "../../../src/lib/runtime-lint/report.js";

function setup(t: Test) {
  resetRuntimeLintForTest(() => 0);
  resetFetchStormForTest();
  t.capture(console, "warn");
  return () => window.__bbxRuntimeLint?.take().records ?? [];
}

/** A transport that fails each operation's first attempt, then answers. */
function flakyTransport(): { link: TRPCLink<AnyRouter>; attempts: () => number } {
  let attempts = 0;
  const seen = new Set<number>();
  return {
    attempts: () => attempts,
    link: () => ({ op }) => observable((observer) => {
      attempts += 1;
      if (!seen.has(op.id)) {
        seen.add(op.id);
        observer.error(TRPCClientError.from(new Error("box did not answer")));
        return;
      }
      observer.next({ result: { type: "data", data: "ok" } });
      observer.complete();
    }),
  };
}

void test("ten starts of one query are reported once; retries do not count", async (t) => {
  const records = setup(t);
  const transport = flakyTransport();
  const client = createTRPCUntypedClient<AnyRouter>({
    links: [runtimeLintLink(), retryLink({ retry: ({ attempts }) => attempts < 2 }), transport.link],
  });
  for (let i = 0; i < 10; i++) await client.query("card.get", { path: "_content/report.doc.card" });
  // The input is the page's first opaque id; the record carries no path.
  t.check({ attempts: transport.attempts(), lines: records().map(formatRecord) }, {
    attempts: 20,
    lines: ["[runtime-lint] fetch-storm procedure=card.get input=c1 starts=9 windowMs=10000"],
  });
});

void test("starts spread past the 10 s window are not a storm", async (t) => {
  const records = setup(t);
  for (let i = 0; i < 20; i++) countRequestStart({ procedure: "raw-file", input: "_content/notes.md", now: i * 2000 });
  t.check(records(), []);
});
