// onConnect fires on every subscription start; onReconnect skips the first
// start, so a caller whose queries load on mount resyncs only after a dropped
// socket comes back.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { test } from "tap";
import type * as BusSubscription from "../../src/hooks/useBusSubscription.js";

void test("onReconnect skips the first start", async (t) => {
  const starts: (() => void)[] = [];
  const fakeTrpc = { trpc: { events: { subscribe: { useSubscription: (_input: unknown, handlers: { onStarted: () => void }) => {
    starts.push(handlers.onStarted);
    return { status: "pending" };
  } } } } };
  const { useBusSubscription } = await t.mockImport<typeof BusSubscription>(
    "../../src/hooks/useBusSubscription.ts",
    { "../../src/lib/trpc/client.ts": fakeTrpc },
  );
  const calls: string[] = [];
  function Host(): ReactNode {
    useBusSubscription({ onEvent: () => {}, onConnect: () => calls.push("connect"), onReconnect: () => calls.push("reconnect") });
    return null;
  }
  const view = await mount(h(Host));
  t.teardown(() => view.unmount());
  const start = starts.at(-1);
  start?.();
  start?.();
  start?.();
  t.check(calls, ["connect", "connect", "reconnect", "connect", "reconnect"]);
});
