// useLiveRefresh: a matching bus event or a reconnect requests one refresh;
// same-tick requests coalesce, burstMs collapses a burst into one refresh, and
// the first connect and non-matching events do nothing.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { test, type Test } from "tap";
import { eventually } from "@ianbicking/tap-check/check";
import type * as LiveRefresh from "../../src/hooks/useLiveRefresh.js";
import type { RealtimeEvent } from "../../src/hooks/useBusSubscription.js";
import { anyFileChange, fileChangeAt, oneOf } from "../../src/lib/live-refresh.js";

interface FakeHandlers {
  onStarted: () => void;
  onData: (data: RealtimeEvent) => void;
}

/** Run queued microtasks, where `useDeferredResync` runs a requested refresh. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function setup(t: Test, opts: { when: (event: RealtimeEvent) => boolean; burstMs?: number }) {
  let handlers: FakeHandlers | null = null;
  const fakeTrpc = { trpc: { events: { subscribe: { useSubscription: (_input: unknown, next: FakeHandlers) => {
    handlers = next;
    return { status: "pending" };
  } } } } };
  const { useLiveRefresh } = await t.mockImport<typeof LiveRefresh>(
    "../../src/hooks/useLiveRefresh.ts",
    { "../../src/lib/trpc/client.ts": fakeTrpc },
  );
  let refreshes = 0;
  function Host(): ReactNode {
    useLiveRefresh({ ...opts, refresh: () => { refreshes += 1; } });
    return null;
  }
  const view = await mount(h(Host));
  t.teardown(() => view.unmount());
  const current = (): FakeHandlers => {
    if (handlers === null) throw new Error("subscription not started");
    return handlers;
  };
  return {
    start: () => current().onStarted(),
    send: (event: RealtimeEvent) => current().onData(event),
    refreshes: () => refreshes,
  };
}

const change = (path: string): RealtimeEvent => ({ event: "file-change", data: { event: "change", path } });

void test("a matching event refreshes once; a non-matching one does nothing", async (t) => {
  const live = await setup(t, { when: fileChangeAt("notes/a.card") });
  live.send(change("/notes/a.card"));
  await flush();
  live.send(change("notes/b.card"));
  live.send({ event: "card-created", data: {} });
  await flush();
  t.check(live.refreshes(), 1);
});

void test("a same-tick burst coalesces into one refresh", async (t) => {
  const live = await setup(t, { when: anyFileChange });
  live.send(change("a.card"));
  live.send(change("b.card"));
  live.send(change("c.card"));
  await flush();
  t.check(live.refreshes(), 1);
});

void test("burstMs collapses a burst; an event after the window refreshes again", async (t) => {
  const live = await setup(t, { when: anyFileChange, burstMs: 30 });
  live.send(change("a.card"));
  await flush();
  // A later tick inside the window: without burstMs this would be a second refresh.
  live.send(change("b.card"));
  await flush();
  t.check(live.refreshes(), 0);
  await eventually(() => live.refreshes() > 0, { label: "burst refresh" });
  t.check(live.refreshes(), 1);
  live.send(change("c.card"));
  await eventually(() => live.refreshes() > 1, { label: "second window's refresh" });
  t.check(live.refreshes(), 2);
});

void test("the first connect does not refresh; a reconnect does", async (t) => {
  const live = await setup(t, { when: oneOf("question-answered") });
  live.start();
  await flush();
  t.check(live.refreshes(), 0);
  live.start();
  await flush();
  t.check(live.refreshes(), 1);
});
