import assert from "node:assert/strict";
import { test } from "node:test";
import { EventScriptError } from "../../src/headless/errors.js";
import { parseTeaEvents } from "../../src/headless/tea-events.js";
import { teaRun } from "../../src/headless/tea-runtime/runner.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { LoadedTeaModule } from "../../src/headless/tea-load.js";
import type { Msg, View } from "../../src/core/tea.js";
import { readDirBytes, readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

// A sketch whose pixels move with the frame number, so an unperturbed run is
// a meaningful thing to diff against.
const mover: LoadedTeaModule = toTeaModule({
  canvas: { width: 50, height: 50 },
  init: () => ({ frame: 0 }),
  update: (model: { frame: number }, msg: Msg) => (msg.type === "tick" ? { frame: msg.frame } : model),
  draw: (v: View, model: { frame: number }) => {
    return [
      v.background("#000000"),
      v.circle(model.frame * 4, 25, 4, { fill: "#ffffff" }),
    ];
  },
});

test("a scripted snapshot event forces a capture with its label", async () => {
  const dir = tmpDir();
  // frames 0..9, every=30 → only frames 0 and 9 capture on their own. The
  // snapshot pulls frame 5 into the transcript with a labeled heading.
  await teaRun(teaRunOptions(mover, { outDir: dir, frames: 10, every: 30, events: [{ frame: 5, type: "snapshot", label: "midway" }] }));
  assert.match(readTranscript(dir), /### frame 5 — midway/, "labeled snapshot frame appears in the transcript");
});

test("a snapshot event captures without perturbing state", async () => {
  const plain = tmpDir();
  const snapped = tmpDir();
  await teaRun(teaRunOptions(mover, { outDir: plain, frames: 10, every: 30, events: [] }));
  await teaRun(teaRunOptions(mover, { outDir: snapped, frames: 10, every: 30, events: [{ frame: 5, type: "snapshot" }] }));
  const plainFrames = readDirBytes(plain);
  const snappedFrames = readDirBytes(snapped);
  // Every frame the plain run captured is byte-identical in the snapshot run;
  // the snapshot only ADDS frame-0005.png, it changes nothing else.
  for (const [name, bytes] of plainFrames) {
    if (name === "transcript.md") continue;
    assert.deepEqual(snappedFrames.get(name), bytes, `${name} is unchanged by the snapshot`);
  }
  assert.ok(snappedFrames.has("frame-0005.png"), "the snapshot added its frame");
});

test("the events parser accepts a snapshot (with and without label) and rejects a non-string label", () => {
  const events = parseTeaEvents(
    [
      { frame: 3, type: "snapshot" },
      { frame: 7, type: "snapshot", label: "peak" },
    ],
    {},
  );
  assert.deepEqual(events, [
    { frame: 3, type: "snapshot" },
    { frame: 7, type: "snapshot", label: "peak" },
  ]);
  assert.throws(
    () => parseTeaEvents([{ frame: 1, type: "snapshot", label: 5 }], {}),
    (e: unknown) => e instanceof EventScriptError && e.message.includes('"label" must be a string'),
  );
});

test("a mousepath the sketch handles captures its first and last frames, not the moves between", async () => {
  const dir = tmpDir();
  const follower: LoadedTeaModule = toTeaModule({
    canvas: { width: 50, height: 50 },
    init: () => ({ x: 0 }),
    // Handled, with an activity: neither its verdict line nor its activity line makes a move's frame captured.
    // eslint-disable-next-line max-params -- TEA contract signature
    update: (model: { x: number }, msg: Msg, u: { handled: (name: string) => void }) => (msg.type === "mousemove" ? (u.handled("follow"), { x: msg.x }) : model),
    activity: (model: { x: number }) => ({ x: Math.round(model.x) }),
    draw: (v: View, model: { x: number }) => [v.background("#000000"), v.circle(model.x, 25, 4, { fill: "#ffffff" })],
  });
  const events = parseTeaEvents([{ frame: 2, type: "mousepath", points: [[5, 25], [45, 25]], frames: 8 }], {});
  await teaRun(teaRunOptions(follower, { outDir: dir, frames: 14, every: 30, events }));
  const captured = [...readTranscript(dir).matchAll(/^### frame (\d+)/gm)].map((m) => Number(m[1]));
  assert.deepEqual(captured, [0, 2, 10, 13], "frame 0, the path's ends and the last frame");
});
