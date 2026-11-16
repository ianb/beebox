import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { toTeaModule } from "../../src/headless/tea-load.js";
import { teaRun } from "../../src/headless/tea-runtime/runner.js";
import type { LoadedTeaModule } from "../../src/headless/tea-load.js";
import type { Drawing, Msg, ParamsDecl, View } from "../../src/core/tea.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

function noop(): null {
  return null;
}

test("mutating a frozen model throws and is recorded as an error", async () => {
  const module: LoadedTeaModule = {
    params: {},
    canvas: undefined,
    init: () => ({ n: 0 }),
    update: (model) => {
      if (typeof model === "object" && model !== null) Object.assign(model, { n: 1 });
      return model;
    },
    draw: noop,
  };
  const dir = tmpDir();
  const result = await teaRun(teaRunOptions(module, { outDir: dir, frames: 3 }));
  assert.equal(result.errors.length, 1, "the frozen-model mutation surfaced one error");
  const [message] = result.errors;
  assert.ok(message !== undefined && /read only|not extensible|frozen/i.test(message), "error is a freeze violation");
});

test("a Promise returned from update is rejected with a clear error", async () => {
  const module: LoadedTeaModule = {
    params: {},
    canvas: undefined,
    init: () => ({}),
    update: () => Promise.resolve({}),
    draw: noop,
  };
  const dir = tmpDir();
  const result = await teaRun(teaRunOptions(module, { outDir: dir, frames: 2 }));
  assert.equal(result.errors.length, 1);
  const [message] = result.errors;
  assert.ok(message !== undefined && message.includes("synchronous"), "names the sync requirement");
});

test("update returning undefined (an unhandled msg) surfaces a typed error naming the msg type", async () => {
  const module: LoadedTeaModule = {
    params: {},
    canvas: undefined,
    init: () => ({ n: 0 }),
    // A box sketch whose update switch has no case for "tick" — no lint runs in
    // a box, so this ships and would otherwise leave the model undefined. The
    // empty body implicitly returns undefined, exactly as a fall-through switch.
    update: () => {},
    draw: noop,
  };
  const dir = tmpDir();
  const result = await teaRun(teaRunOptions(module, { outDir: dir, frames: 2 }));
  assert.equal(result.errors.length, 1, "the undefined-return surfaced one error");
  const [message] = result.errors;
  assert.ok(message !== undefined && message.includes("tick"), "the error names the unhandled msg type");
  assert.ok(message !== undefined && /returned undefined/.test(message), "the error explains update returned undefined");
});

test("within a frame, scripted msgs fold before the tick", async () => {
  const params: ParamsDecl = { speed: { type: "number", min: 0, max: 5, default: 1 } };
  const module: LoadedTeaModule = {
    params,
    canvas: undefined,
    init: () => ({}),
    // console.log routes into the same frame-tagged transcript, so a 2-param
    // update reads clean here — no need for the util channel.
    update: (model, msg: Msg) => {
      if (msg.type === "param") console.log(`saw param ${String(msg.value)}`);
      if (msg.type === "tick") console.log(`saw tick ${msg.frame}`);
      return model;
    },
    draw: noop,
  };
  const dir = tmpDir();
  await teaRun(
    teaRunOptions(module, {
      outDir: dir,
      frames: 2,
      events: [{ frame: 0, type: "param", name: "speed", value: 2.5 }],
    }),
  );
  const transcript = readTranscript(dir);
  const autoLine = transcript.indexOf("param: speed → 2.5");
  const sawParam = transcript.indexOf("saw param 2.5");
  const sawTick = transcript.indexOf("saw tick 0");
  assert.ok(autoLine !== -1 && sawParam > autoLine, "auto param line precedes the update's own log");
  assert.ok(sawTick > sawParam, "the param msg folds before the tick msg");
});

test("interaction events get an engagement verdict: named, Δmodel, and (unhandled)", async () => {
  const module: LoadedTeaModule = {
    params: {},
    canvas: undefined,
    init: () => ({ n: 0 }),
    // eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined fold signature
    update: (model, msg: Msg, u) => {
      switch (msg.type) {
        case "mousedown":
          // A hit names itself; the miss returns the same reference silently.
          if (msg.x < 100) u.handled("select");
          return model;
        case "keydown":
          // A fresh object: a changed model reference, but no name.
          return { n: 1 };
        default:
          return model;
      }
    },
    draw: noop,
  };
  const dir = tmpDir();
  await teaRun(
    teaRunOptions(module, {
      outDir: dir,
      frames: 3,
      events: [
        { frame: 0, type: "mousedown", x: 50, y: 50 },
        { frame: 1, type: "keydown", key: "a" },
        { frame: 2, type: "mousedown", x: 200, y: 50 },
      ],
    }),
  );
  const transcript = readTranscript(dir);
  assert.ok(transcript.includes("**[frame 0]** mousedown (50,50) → select"), "a named u.handled() shows the name");
  assert.ok(transcript.includes("**[frame 1]** keydown a → Δmodel"), "a new model reference with no name reads Δmodel");
  assert.ok(transcript.includes("**[frame 2]** mousedown (200,50) → (unhandled)"), "same reference, no name reads (unhandled)");
});

test("param values reach draw and update through u.params / p", async () => {
  const params: ParamsDecl = { speed: { type: "number", min: 0, max: 5, default: 1 } };
  const seen: number[] = [];
  const module: LoadedTeaModule = {
    params,
    canvas: undefined,
    init: () => ({}),
    update: (model) => model,
    // eslint-disable-next-line max-params -- TEA contract: draw(view, model, params) is the framework-defined render signature
    draw: (_v: View, _model, p) => {
      const value = p["speed"];
      if (typeof value === "number") seen.push(value);
      return null;
    },
  };
  const dir = tmpDir();
  await teaRun(
    teaRunOptions(module, {
      outDir: dir,
      frames: 4,
      events: [{ frame: 2, type: "param", name: "speed", value: 4 }],
    }),
  );
  assert.deepEqual(seen, [1, 1, 4, 4], "draw sees the updated param value from the frame it changed");
});

test("initial params start the run from other values; a bad one is an error", async () => {
  const params = { speed: { type: "number", min: 0, max: 5, default: 1 }, tone: { type: "select", options: ["sky", "moss"], default: "sky" } } as const satisfies ParamsDecl;
  const seen: string[] = [];
  const module: LoadedTeaModule = {
    params,
    canvas: undefined,
    init: (u) => `${String(u.params["speed"])} ${String(u.params["tone"])}`,
    update: (model) => model,
    draw: (_v: View, model: unknown) => void seen.push(String(model)),
  };
  await teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 1, initialParams: { speed: 3, tone: "moss" } }));
  assert.deepEqual(seen, ["3 moss"]);
  await assert.rejects(teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 1, initialParams: { sped: 3 } })), /initial param "sped": the sketch declares no such param/u);
  await assert.rejects(teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 1, initialParams: { speed: 9 } })), /refused, since it would be clamped 9 to the declared \[0, 5\]/u);
  await assert.rejects(teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 1, initialParams: { tone: "red" } })), /not one of the declared options/u);
});

test("a step that throws ends the transcript with its line and the sketch's line; the frames before it stay", async () => {
  const module: LoadedTeaModule = {
    params: {},
    canvas: { width: 20, height: 20 },
    init: () => ({ t: 0 }),
    update: (model, msg: Msg) => (msg.type === "tick" ? { t: msg.frame } : model),
    draw: (v: View, model: unknown) => {
      const out: Drawing[] = [];
      out.push(v.background("#000000"));
      if (typeof model === "object" && model !== null && Reflect.get(model, "t") === 2) throw new RangeError("no third frame");
      return out;
    },
  };
  const dir = tmpDir();
  const result = await teaRun(teaRunOptions(module, { outDir: dir, frames: 4, every: 1 }));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0] ?? "", /^frame 2: error in draw: RangeError: no third frame \(at test\/headless\/tea-runtime\.gpu\.test\.ts:\d+:\d+\)$/u);
  assert.equal(result.framesRun, 3);
  const transcript = readTranscript(dir);
  assert.match(transcript, /^frame 2: error in draw: RangeError: no third frame \(at [^)]+\)\n\n```\n {2}at test\/headless\/tea-runtime\.gpu\.test\.ts:\d+:\d+\n/mu);
  assert.ok(transcript.includes("### frame 1"), "frame 1 was captured");
  assert.ok(!transcript.includes("### frame 2"), "the failed frame has no image");
});

test("reading a param the sketch does not declare is an error naming the declared ones", async () => {
  const module: LoadedTeaModule = {
    params: { size: { type: "number", min: 1, max: 9, default: 3 } },
    canvas: { width: 20, height: 20 },
    init: () => ({}),
    update: (model) => model,
    // eslint-disable-next-line max-params -- TEA contract: draw(view, model, params) is the framework-defined render signature
    draw: (_v: View, _model: unknown, p) => void p["speed"],
  };
  const result = await teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 1 }));
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0]?.startsWith('frame 0: error in draw: SketchUsageError: Sketch API misuse: params.speed: the sketch declares no param "speed" (declared: size); add it to the params export (at test/headless/tea-runtime.gpu.test.ts:'), result.errors[0]);
});

// Ported from the Canvas2D painter's tests when it was deleted (scene core chunk 6).
const debugBoxSketch = toTeaModule({
  canvas: { width: 60, height: 40 },
  init: () => ({}),
  update: (model: object) => model,
  draw: (v: View): Drawing => {
    return [
      v.background("#ffffff"),
      v.debugBox("hit", 10, 20, 30, 15),
    ];
  },
});

test("debugBox draws only with --outline, over the finished frame", async () => {
  const frames: Buffer[] = [];
  for (const outline of [false, true]) {
    const outDir = tmpDir();
    await teaRun(teaRunOptions(debugBoxSketch, { outDir, frames: 1, outline }));
    frames.push(readFileSync(join(outDir, "frame-0000.png")));
  }
  const plain = tmpDir();
  await teaRun(teaRunOptions(toTeaModule({ ...debugBoxSketch, draw: (v: View): Drawing => v.background("#ffffff") }), { outDir: plain, frames: 1 }));
  assert.ok(frames[0]?.equals(readFileSync(join(plain, "frame-0000.png"))), "without --outline the box draws nothing");
  assert.ok(frames[1] !== undefined && !frames[1].equals(frames[0] ?? Buffer.alloc(0)), "with --outline the box shows");
});

test("--timing adds one timing summary line to the transcript", async () => {
  const outDir = tmpDir();
  const module = toTeaModule({ canvas: { width: 10, height: 10 }, init: () => ({}), update: (model: object) => model, draw: (v: View): Drawing => v.background("#000") });
  await teaRun(teaRunOptions(module, { outDir, frames: 5, timing: true }));
  assert.equal(readTranscript(outDir).match(/timing: draw avg [\d.]+ ms, p95 [\d.]+ ms, max [\d.]+ ms \(frame \d+\); update avg [^;]+; frame 0 draw/g)?.length, 1);
});
