import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { toTeaModule } from "../src/headless/tea-load.js";
import { parseTeaEvents } from "../src/headless/tea-events.js";
import { teaRun } from "../src/headless/tea-runtime.js";
import * as orbitTea from "../examples/orbit-tea.js";
import { readDirBytes, teaRunOptions, tmpDir } from "./helpers.js";

const eventsJson = fileURLToPath(new URL("../examples/orbit-tea-events.json", import.meta.url));

test("two TEA runs of the same sketch produce byte-identical output", () => {
  const module = toTeaModule(orbitTea);
  const events = parseTeaEvents(JSON.parse(readFileSync(eventsJson, "utf8")), module.params);
  const dirA = tmpDir();
  const dirB = tmpDir();
  teaRun(teaRunOptions(module, { outDir: dirA, frames: 120, events }));
  teaRun(teaRunOptions(module, { outDir: dirB, frames: 120, events }));

  const a = readDirBytes(dirA);
  const b = readDirBytes(dirB);
  assert.deepEqual([...a.keys()], [...b.keys()], "same set of output files");
  assert.ok(a.size > 1, "produced frames plus a transcript");
  for (const [name, bytesA] of a) {
    const bytesB = b.get(name);
    assert.ok(bytesB !== undefined, `${name} exists in both runs`);
    assert.equal(Buffer.compare(bytesA, bytesB), 0, `${name} is byte-identical`);
  }
});

test("a run that calls u.handled() is still byte-identical across two runs", () => {
  const module = {
    params: {},
    canvas: undefined,
    init: () => ({ n: 0 }),
    // eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined fold signature
    update: (model: { n: number }, msg: { type: string }, u: { handled: (name: string) => void }) => {
      if (msg.type === "mousedown") {
        u.handled("tap");
        return { n: model.n + 1 };
      }
      return model;
    },
    draw: () => {},
  };
  const events = [
    { frame: 0, type: "mousedown", x: 10, y: 10 },
    { frame: 1, type: "mousemove", x: 20, y: 20 },
  ] as const;
  const dirA = tmpDir();
  const dirB = tmpDir();
  teaRun(teaRunOptions(toTeaModule(module), { outDir: dirA, frames: 4, events: [...events] }));
  teaRun(teaRunOptions(toTeaModule(module), { outDir: dirB, frames: 4, events: [...events] }));
  const a = readDirBytes(dirA);
  const b = readDirBytes(dirB);
  assert.deepEqual([...a.keys()], [...b.keys()], "same output files");
  for (const [name, bytesA] of a) {
    assert.equal(Buffer.compare(bytesA, b.get(name) ?? Buffer.alloc(0)), 0, `${name} is byte-identical`);
  }
});

test("param changes are logged and selection hit-tests land on moving planets", () => {
  const module = toTeaModule(orbitTea);
  const events = parseTeaEvents(JSON.parse(readFileSync(eventsJson, "utf8")), module.params);
  const dir = tmpDir();
  teaRun(teaRunOptions(module, { outDir: dir, frames: 120, events }));
  const transcript = readFileSync(`${dir}/transcript.md`, "utf8");
  assert.ok(transcript.includes("**[frame 70]** param: speed-scale → 2.5"), "param change auto-logged");
  assert.ok(transcript.includes("**[frame 30]** log: selected Venus"), "click hit a moving planet");
  assert.ok(transcript.includes("**[frame 100]** log: selected Mercury"), "click hit under a changed speed-scale");
});
