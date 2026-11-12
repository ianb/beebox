// The browser player loads the sample library on its own: a sample voice due
// while it loads waits and plays when it arrives, unless it is too late.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SoundPlayer } from "../../../src/browser/runtime/sound-player.js";

const started: number[] = [];

interface FakeSource {
  buffer: { length: number } | null;
  connect: () => void;
  addEventListener: () => void;
  start: () => void;
  stop: () => void;
}

// The player's clock, frozen unless a test moves it, so load time does not matter.
let clock = 0;
Object.defineProperty(performance, "now", { configurable: true, value: () => clock });

class FakeAudioContext {
  state = "suspended";
  destination = {};
  resume(): Promise<void> {
    return Promise.resolve();
  }
  createBuffer(_channels: number, length: number): { length: number; copyToChannel: () => void } {
    return { length, copyToChannel: () => {} };
  }
  createBufferSource(): FakeSource {
    const source: FakeSource = {
      buffer: null,
      connect: () => {},
      addEventListener: () => {},
      start: () => started.push(source.buffer?.length ?? 0),
      stop: () => {},
    };
    return source;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
Object.assign(globalThis, { AudioContext: FakeAudioContext });

/** Wait until `count` sources have started, or 5 s. */
async function startedReach(count: number): Promise<void> {
  for (let waited = 0; started.length < count && waited < 5000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
}

test("a sample voice due while the library loads plays once it arrives", async () => {
  started.length = 0;
  const logs: string[] = [];
  const player = new SoundPlayer((message) => logs.push(message));
  player.enable();
  player.play({ id: "d", at: 0, kind: "sample", name: "ding" });
  player.play({ id: "n", at: 0, kind: "note", instrument: "marimba", note: "C4" });
  // The note needs no library and plays at once (after enable's silent sample).
  assert.equal(started.length, 2);
  await startedReach(3);
  assert.equal(started.length, 3, "the ding played when the library arrived");
  assert.deepEqual(logs, []);
  player.close();
});

test("a sample voice that waited too long is dropped with a log line", async () => {
  started.length = 0;
  const logs: string[] = [];
  const player = new SoundPlayer((message) => logs.push(message));
  player.enable();
  player.play({ id: "late", at: 0, kind: "sample", name: "ding" });
  clock += 1000;
  for (let waited = 0; logs.length === 0 && waited < 5000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(started.length, 1, "only enable's silent sample");
  assert.match(logs.join("\n"), /sample "late" dropped/u);
  player.close();
});
