// # Simulated clock in the agent's date lines
//
// On a walk fixture box with a clock offset, the chat snapshot carries
// a `clock` note and scheduled agent runs append the box time. A box
// without an offset gets neither.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { composeSendSnapshot } from "../../src/core/session-context.js";
import { buildAgentTimeContext } from "../../src/core/agent/invoke/simulated-clock.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// BBX_TIME wins over the offset file and makes the box time deterministic.
const BOX_NOW = "2026-10-30T14:00:00Z";

async function makeBox(opts: { offset: boolean }): Promise<Awaited<ReturnType<typeof makeTmpBox>>> {
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify({ timezone: "UTC", fakeNotifications: true }));
  if (opts.offset) await box.write(".beebox/clock-offset.json", JSON.stringify({ offsetMs: 604800000, setAt: "2026-10-23T00:00:00Z" }));
  return box;
}

void test("The chat-app tag carries clock=simulated only under a shifted clock", async (t) => {
  const saved = process.env.BBX_TIME;
  t.teardown(() => {
    if (saved === undefined) delete process.env.BBX_TIME;
    else process.env.BBX_TIME = saved;
  });
  const shifted = await makeBox({ offset: true });
  const plain = await makeBox({ offset: false });
  t.teardown(async () => {
    await shifted.cleanup();
    await plain.cleanup();
  });
  process.env.BBX_TIME = BOX_NOW;
  const withOffset = await composeSendSnapshot(shifted.root, { sessionStart: false });
  delete process.env.BBX_TIME;
  const without = await composeSendSnapshot(plain.root, { sessionStart: false });

  t.check(withOffset, '<chat-app local-time="Friday 2026-10-30 14:00 UTC (afternoon)" clock="simulated: local-time is the date; the date in your system context is the host\'s; do not mention the difference"/>');
  t.check(without.replace(/local-time="[^"]*"/, 'local-time="<now>"'), '<chat-app local-time="<now>"/>');
});

void test("The agent run append states the box time only under a shifted clock", async (t) => {
  const saved = process.env.BBX_TIME;
  t.teardown(() => {
    if (saved === undefined) delete process.env.BBX_TIME;
    else process.env.BBX_TIME = saved;
  });
  const shifted = await makeBox({ offset: true });
  const plain = await makeBox({ offset: false });
  t.teardown(async () => {
    await shifted.cleanup();
    await plain.cleanup();
  });
  process.env.BBX_TIME = BOX_NOW;
  const withOffset = await buildAgentTimeContext(shifted.root);
  delete process.env.BBX_TIME;
  const without = await buildAgentTimeContext(plain.root);

  t.check(withOffset, "\nTimezone: UTC\nThis box runs on a simulated clock. The current time is Friday 2026-10-30 14:00 UTC (afternoon). The date in your system context is the host's; use the current time given here and do not mention the difference.");
  t.check(without, "\nTimezone: UTC");
});
