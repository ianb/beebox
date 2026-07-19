import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchEvent } from "../src/headless/events.js";
import { run } from "../src/headless/runtime.js";
import { Sketch, type SketchModule } from "../src/headless/sketch.js";
import type { SketchEvent, SketchHost, SketchInputEvent } from "../src/core/types.js";
import { readTranscript, runOptions, tmpDir } from "./helpers.js";

const silentHost: SketchHost = { recordLog() {}, requestSnapshot() {} };

test("mouse events dispatch in order, and a move-while-pressed fires mouseDragged", () => {
  const calls: string[] = [];
  const module: SketchModule = {
    setup() {},
    draw() {},
    mousePressed(_s: Sketch, e: SketchInputEvent) {
      calls.push(`pressed(${e.x},${e.y})`);
    },
    mouseDragged(_s: Sketch, e: SketchInputEvent) {
      calls.push(`dragged(${e.x},${e.y})`);
    },
    mouseReleased(_s: Sketch, e: SketchInputEvent) {
      calls.push(`released(${e.x},${e.y})`);
    },
    mouseMoved(_s: Sketch, e: SketchInputEvent) {
      calls.push(`moved(${e.x},${e.y})`);
    },
  };
  const sketch = new Sketch({ host: silentHost, seed: 1, fps: 60, onHandled: () => {} });
  sketch.createCanvas(20, 20);

  const script: SketchEvent[] = [
    { frame: 0, type: "mousedown", x: 5, y: 5 },
    { frame: 0, type: "mousemove", x: 8, y: 9 },
    { frame: 0, type: "mouseup", x: 8, y: 9 },
    { frame: 0, type: "mousemove", x: 1, y: 2 },
  ];
  for (const event of script) dispatchEvent({ sketch, module, event });

  assert.deepEqual(calls, ["pressed(5,5)", "dragged(8,9)", "released(8,9)", "moved(1,2)"]);
  assert.equal(sketch.mouseX, 1);
  assert.equal(sketch.mouseY, 2);
  assert.equal(sketch.mouseIsPressed, false);
});

test("key events update keysDown and fire handlers", () => {
  const pressed: string[] = [];
  const module: SketchModule = {
    setup() {},
    draw() {},
    keyPressed(_s: Sketch, e: SketchInputEvent) {
      pressed.push(e.key);
    },
  };
  const sketch = new Sketch({ host: silentHost, seed: 1, fps: 60, onHandled: () => {} });
  sketch.createCanvas(20, 20);
  dispatchEvent({ sketch, module, event: { frame: 0, type: "keydown", key: "a" } });
  assert.equal(sketch.keysDown.has("a"), true);
  dispatchEvent({ sketch, module, event: { frame: 0, type: "keyup", key: "a" } });
  assert.equal(sketch.keysDown.has("a"), false);
  assert.deepEqual(pressed, ["a"]);
});

test("scripted inputs get an engagement verdict: named, handler-fired, and unhandled", () => {
  const module: SketchModule = {
    setup(s: Sketch) {
      s.createCanvas(20, 20);
    },
    draw() {},
    // A named acknowledgment.
    mousePressed(s: Sketch) {
      s.handled("grab");
    },
    // Fires but names nothing → the free "a handler ran" signal.
    mouseMoved() {},
    // No keyPressed handler → a keydown engages nothing.
  };
  const dir = tmpDir();
  run(
    runOptions(module, {
      outDir: dir,
      frames: 3,
      events: [
        { frame: 0, type: "mousemove", x: 6, y: 7 },
        { frame: 1, type: "mousedown", x: 5, y: 5 },
        { frame: 2, type: "keydown", key: "a" },
      ],
    }),
  );
  const transcript = readTranscript(dir);
  assert.ok(transcript.includes("**[frame 0]** mousemove (6,7) → handled"), "an unnamed handler that fired reads 'handled'");
  assert.ok(transcript.includes("**[frame 1]** mousedown (5,5) → grab"), "s.handled(name) shows the name");
  assert.ok(transcript.includes("**[frame 2]** keydown a → (unhandled)"), "no matching handler reads (unhandled)");
});

test("events within one frame are logged in file order through run()", () => {
  const module: SketchModule = {
    setup(s: Sketch) {
      s.createCanvas(20, 20);
    },
    draw() {},
    mousePressed(s: Sketch) {
      s.log("down");
    },
    mouseDragged(s: Sketch) {
      s.log(`drag ${s.mouseX}`);
    },
  };
  const dir = tmpDir();
  run(
    runOptions(module, {
      outDir: dir,
      frames: 2,
      events: [
        { frame: 0, type: "mousedown", x: 1, y: 1 },
        { frame: 0, type: "mousemove", x: 2, y: 2 },
        { frame: 0, type: "mousemove", x: 3, y: 3 },
      ],
    }),
  );
  const transcript = readTranscript(dir);
  const down = transcript.indexOf("log: down");
  const drag2 = transcript.indexOf("log: drag 2");
  const drag3 = transcript.indexOf("log: drag 3");
  assert.ok(down !== -1 && drag2 > down && drag3 > drag2, "handlers logged in dispatch order");
});
