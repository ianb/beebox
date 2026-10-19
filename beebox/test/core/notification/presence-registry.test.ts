// # Presence registry: one tracker per box someone is using
//
// The server keeps a presence tracker per box. A heartbeat creates the box's
// entry and starts a sweep that keeps `.beebox/presence.json` current. Once the
// last tab lapses and the drop to zero is written, the sweep stops and the entry
// is removed, so a server that has seen many boxes holds entries only for the
// boxes in use.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { createPresenceRegistry } from "../../../src/core/notification/presence-registry/core.js";
import { livePresence } from "../../../src/core/notification/presence.js";

const T0 = Date.parse("2026-09-26T12:00:00Z");
let clock = T0;
const at = (seconds: number) => new Date(T0 + seconds * 1000);
// A long interval: the doctest runs the sweeps itself.
const registry = createPresenceRegistry({ sweepMs: 3_600_000, now: () => new Date(clock) });

// ## Heartbeat, lapse, and the entry is gone
void test("Heartbeat, lapse, and the entry is gone", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L24
  const box = await makeTmpBox();
  await registry.heartbeat(box.root, "tab-aaaaaaaa");
  t.check([registry.size(), (await livePresence(box.root, { now: at(0) })).activeWeb], [
    1,
    1,
  ]);

  // Two minutes later the tab has lapsed. The first sweep writes zero and keeps
  // the entry; the next finds nothing due and removes it.

  // doctest:L34
  clock = T0 + 120_000;
  await registry.sweep(box.root);
  t.check([registry.size(), (await livePresence(box.root, { now: at(120) })).activeWeb], [
    1,
    0,
  ]);

  // doctest:L39
  await registry.sweep(box.root);
  t.check(registry.size(), 0);

  // A later heartbeat starts a fresh entry and writes the count again:

  // doctest:L47
  await registry.heartbeat(box.root, "tab-bbbbbbbb");
  t.check([registry.size(), (await livePresence(box.root, { now: at(120) })).activeWeb], [
    1,
    1,
  ]);

  // doctest:L51
  clock = T0 + 300_000;
  await registry.sweep(box.root);
  await registry.sweep(box.root);
  t.check(registry.size(), 0);
});
