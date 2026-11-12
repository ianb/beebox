import assert from "node:assert/strict";
import { test } from "node:test";
import { teaRun } from "../../src/headless/tea-runtime.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { Msg } from "../../src/core/tea.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

test("mouse and key events reach update as msgs in script order, with their coordinates and keys", () => {
  const logged: string[] = [];
  const module = toTeaModule({
    canvas: { width: 20, height: 20 },
    init: () => ({}),
    update: (model: object, msg: Msg): object => {
      const line = msg.type === "tick" ? undefined : msg.type.startsWith("key") ? `${msg.type}(${"key" in msg ? msg.key : ""})` : `${msg.type}(${"x" in msg ? msg.x : ""},${"y" in msg ? msg.y : ""})`;
      if (line !== undefined) logged.push(line);
      return model;
    },
    draw: () => {},
  });
  const dir = tmpDir();
  teaRun(
    teaRunOptions(module, {
      outDir: dir,
      frames: 1,
      events: [
        { frame: 0, type: "mousedown", x: 5, y: 5 },
        { frame: 0, type: "mousemove", x: 8, y: 9 },
        { frame: 0, type: "mouseup", x: 8, y: 9 },
        { frame: 0, type: "mousemove", x: 1, y: 2 },
        { frame: 0, type: "keydown", key: "a" },
        { frame: 0, type: "keyup", key: "a" },
      ],
    }),
  );
  assert.deepEqual(logged, ["mousedown(5,5)", "mousemove(8,9)", "mouseup(8,9)", "mousemove(1,2)", "keydown(a)", "keyup(a)"]);
});

test("events within one frame are logged in file order", () => {
  const module = toTeaModule({
    canvas: { width: 20, height: 20 },
    init: () => ({}),
    update: (model: object, msg: Msg) => {
      if (msg.type === "mousedown") console.log("down");
      if (msg.type === "mousemove") console.log(`move ${msg.x}`);
      return model;
    },
    draw: () => {},
  });
  const dir = tmpDir();
  teaRun(
    teaRunOptions(module, {
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
  const move2 = transcript.indexOf("log: move 2");
  const move3 = transcript.indexOf("log: move 3");
  assert.ok(down !== -1 && move2 > down && move3 > move2, "msgs logged in dispatch order");
});
