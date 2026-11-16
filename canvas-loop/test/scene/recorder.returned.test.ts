// The returned form (returned-scene plan, chunk R2): drawing calls return
// nodes, scopes take their children as values, and `draw` returns its drawing.
// Children are flattened into a list the node owns; a node belongs to the
// frame that made it; a `draw` that returns nothing is the retired statement
// form; testing mode warns of a node made and never returned; paper is a
// scope, and a picture takes its own paper.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { Drawing, DrawingNode, View } from "../../src/core/tea.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { RemovedCallError } from "../../src/scene/errors.js";
import type { SceneNode, TextNode } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});

const FILL = { fill: "#000" } as const;
const PENCIL = { stroke: "#000", brush: "pencil" } as const;

/** The line of this file the caller is on. */
function here(): number {
  const m = /recorder\.returned\.test\.ts:(\d+):\d+/.exec(new Error("here").stack?.split("\n")[2] ?? "");
  return Number(m?.[1]);
}

function testing(size?: { width: number; height: number }): SceneRecorder {
  return new SceneRecorder(size ?? { width: 100, height: 80 }, { audit: true, ...(text === undefined ? {} : { text }) });
}

const never = (): boolean => false;

/** Each node's kind (or shape call), nested lists for children. */
function shapeOf(nodes: readonly SceneNode[]): unknown[] {
  return nodes.map((n) => {
    switch (n.kind) {
      case "shape":
        return n.call;
      case "at":
      case "group":
      case "clip":
        return [n.kind, shapeOf(n.children)];
      case "mask":
        return ["mask", shapeOf(n.mask), shapeOf(n.body)];
      case "text":
      case "place":
      case "light":
      case "background":
      case "debug":
        return n.kind;
    }
  });
}

test("children: nested lists are flattened, and null, undefined and false are skipped", () => {
  const { scene } = new SceneRecorder({ width: 10, height: 10 }).record((v) => [
    v.rect(0, 0, 1, 1, FILL),
    [null, [v.circle(0, 0, 1, FILL), [undefined, false]], []],
    v.group({}, [[v.line(0, 0, 1, 1, PENCIL)], null, never() && v.rect(0, 0, 1, 1, FILL)]),
    v.at({ rotate: 1 }, v.ellipse(0, 0, 1, 1, FILL)),
  ]);
  assert.deepEqual(shapeOf(scene.children), ["rect", "circle", ["group", ["line"]], ["at", ["ellipse"]]]);
});

test("children: a number, a string, true, a plain object and a function are refused at the call", () => {
  const rec = new SceneRecorder({ width: 10, height: 10 });
  // Each refused value goes in untyped (the types refuse them first), as from a sketch compiled without types.
  const refused: [string, (v: View) => unknown, RegExp][] = [
    ["number", (v) => v.group({}, identity([0])), /group: a child must be a drawing .* got the number 0 \(a condition like `count && v\.rect\(…\)`/],
    ["string", (v) => v.at({}, identity(["label"])), /at: .* got the string "label"/],
    ["true", (v) => v.clip([[0, 0], [1, 0], [1, 1]], identity([true])), /clip: .* got true/],
    ["object", (v) => v.mask(identity([{ kind: "shape" }]), []), /mask: .* got an object that is not a drawing/],
    ["root", () => [v0()], /draw: .* got an object that is not a drawing/],
  ];
  for (const [what, draw, message] of refused) assert.throws(() => rec.record(draw), (e: unknown) => e instanceof SketchUsageError && message.test(e.message), what);
  for (const call of ["at", "group", "clip", "mask"] as const) {
    const draw = (v: View): unknown => {
      const body = (): void => undefined;
      switch (call) {
        case "at":
          return v.at({}, identity(body));
        case "group":
          return v.group({}, identity(body));
        case "clip":
          return v.clip([[0, 0], [1, 0], [1, 1]], identity(body));
        case "mask":
          return v.mask(identity(body), []);
      }
    };
    assert.throws(() => rec.record(draw), (e: unknown) => e instanceof RemovedCallError && e.call === `${call}(${call === "mask" ? "mask art" : "options"}, body function)` && e.replacement.includes("as a list"), call);
  }
});

/** An object that looks like a node but was not made by a drawing call. */
function v0(): object {
  return { kind: "shape", call: "rect" };
}
/** Hands a value through untyped, as a sketch compiled without types would. */
function identity(x: unknown): Drawing {
  return Reflect.apply((y: Drawing) => y, undefined, [x]);
}

test("children are copied at construction: changing the list afterwards changes nothing", () => {
  const { scene } = new SceneRecorder({ width: 10, height: 10 }).record((v) => {
    const kids: DrawingNode[] = [v.rect(0, 0, 1, 1, FILL)];
    const group = v.group({}, kids);
    kids.push(v.circle(0, 0, 1, FILL));
    kids.length = 0;
    return [group, kids];
  });
  assert.deepEqual(shapeOf(scene.children), [["group", ["rect"]]]);
});

test("a node may appear twice in its frame; a node from an earlier frame is refused, in a scope and at the root", () => {
  const rec = new SceneRecorder({ width: 10, height: 10 });
  let kept: DrawingNode | undefined;
  const { scene } = rec.record((v) => {
    kept = v.rect(0, 0, 1, 1, FILL);
    return [kept, v.at({ translate: [2, 0] }, kept)];
  });
  assert.deepEqual(shapeOf(scene.children), ["rect", ["at", ["rect"]]]);
  const earlier = /this drawing was made in an earlier frame; make it again in draw, or record it once as a picture/;
  assert.throws(() => rec.record(() => kept ?? null), (e: unknown) => e instanceof SketchUsageError && earlier.test(e.message));
  assert.throws(() => rec.record((v) => v.group({}, kept ?? null)), (e: unknown) => e instanceof SketchUsageError && /^.*group: this drawing/.test(e.message));
});

test("a draw that returns undefined is the retired statement form, whatever it made; null, false and [] draw nothing", () => {
  const rec = new SceneRecorder({ width: 10, height: 10 });
  const statements = (v: View): void => void v.rect(0, 0, 1, 1, FILL);
  assert.throws(
    () => rec.record(statements),
    (e: unknown) => e instanceof RemovedCallError && e.call === "drawing calls as statements" && e.replacement.startsWith("return the drawing from draw"),
  );
  const nothing = (): void => {};
  assert.throws(() => rec.record(nothing), RemovedCallError, "nothing made");
  for (const empty of [null, false, []]) assert.deepEqual(rec.record(() => empty).scene.children, []);
});

test("testing mode warns once per line of a node made and not returned, at most 8 lines a frame", () => {
  let line = 0;
  const rec = testing();
  const draw = (v: View): Drawing => {
    const kept = v.rect(0, 0, 1, 1, FILL);
    for (let i = 0; i < 3; i++) {
      v.circle(i, 0, 1, FILL); line = here();
    }
    return kept;
  };
  assert.deepEqual(rec.record(draw).warnings, [`v.circle made a drawing that was not returned; put it in the list draw returns, or in a scope's children (at test/scene/recorder.returned.test.ts:${line}:9)`]);
  assert.deepEqual(rec.record(draw).warnings, [], "a line warns once per run");
  const many = testing().record((v) => {
    v.rect(0, 0, 1, 1, FILL); v.rect(0, 0, 1, 1, FILL); v.rect(0, 0, 1, 1, FILL);
    v.rect(0, 0, 1, 1, FILL); v.rect(0, 0, 1, 1, FILL); v.rect(0, 0, 1, 1, FILL);
    v.rect(0, 0, 1, 1, FILL); v.rect(0, 0, 1, 1, FILL); v.rect(0, 0, 1, 1, FILL);
    v.rect(0, 0, 1, 1, FILL); v.rect(0, 0, 1, 1, FILL);
    return null;
  });
  assert.equal(many.warnings.length, 8);
  // Statements share a line; the column tells them apart.
  assert.ok(many.warnings.every((w) => w.startsWith("v.rect made a drawing that was not returned")));
});

test("made and not returned: a node inside an unreturned scope warns only for the scope; picture bodies and the frame may trade nodes", () => {
  const scoped = testing().record((v) => {
    v.group({ name: "lost" }, [v.rect(0, 0, 1, 1, FILL), v.circle(0, 0, 1, FILL)]);
    return null;
  });
  assert.equal(scoped.warnings.length, 1);
  assert.match(scoped.warnings[0] ?? "", /^v\.group made a drawing that was not returned/);
  const traded = testing().record((v) => {
    const outer = v.rect(0, 0, 1, 1, FILL);
    let inner: DrawingNode | undefined;
    const p = v.picture({ key: "trade", width: 4, height: 4 }, () => {
      inner = v.circle(0, 0, 1, FILL);
      return outer;
    });
    return [v.place(p, 0, 0), inner ?? null];
  });
  assert.deepEqual(traded.warnings, [], "a frame node returned by a body, and a body node returned by the frame, are drawn");
  const unplaced = testing().record((v) => {
    v.picture({ key: "stray", width: 4, height: 4 }, () => {
      v.line(0, 0, 1, 1, PENCIL);
      return null;
    });
    return null;
  });
  assert.match(unplaced.warnings.join("\n"), /^v\.line made a drawing that was not returned/);
});

test("made and not returned: a draw that throws gives its error and no such warning; the next frame starts clean", () => {
  const rec = testing();
  assert.throws(() =>
    rec.record((v) => {
      v.rect(0, 0, 1, 1, FILL);
      throw new SketchUsageError({ detail: "boom" });
    }),
  /boom/);
  assert.deepEqual(rec.record((v) => v.circle(0, 0, 1, FILL)).warnings, []);
});

test("a re-record of a kept picture (testing mode) counts no node as made", () => {
  const rec = testing();
  const draw = (v: View): Drawing => v.place(v.picture({ key: "k", width: 4, height: 4 }, () => v.rect(0, 0, 1, 1, FILL)), 0, 0);
  assert.deepEqual(rec.record(draw).warnings, []);
  assert.deepEqual(rec.record(draw).warnings, [], "the second frame re-records the body and compares");
});

test("a picture's paper option is part of its version; placed in a paper scope with other paper, a brushed picture hints once", () => {
  const rec = testing();
  let line = 0;
  const brushed = (v: View, paper?: { seed: number }): Drawing => {
    const p = v.picture({ key: "b", width: 4, height: 4, ...(paper === undefined ? {} : { paper }) }, () => v.line(0, 0, 4, 4, PENCIL));
    const node = v.place(p, 0, 0); line = here();
    return node;
  };
  const first = rec.record((v) => v.paper({ seed: 5 }, brushed(v)));
  assert.deepEqual(first.warnings, []);
  assert.deepEqual(first.hints, [`picture "b" keeps its own paper (its paper option, default the default paper) but is placed inside a v.paper scope with other paper; to draw it on that paper, pass the same settings as the picture's paper option (at test/scene/recorder.returned.test.ts:${line}:20)`]);
  const placed = first.scene.children[0];
  assert.ok(placed?.kind === "place" && placed.picture.kind === "picture");
  const [stroke] = placed.picture.children;
  assert.ok(stroke?.kind === "shape");
  assert.equal(stroke.style.brush?.paper.seed, 1, "the picture keeps the default paper");
  const matched = rec.record((v) => v.paper({ seed: 5 }, brushed(v, { seed: 5 })));
  assert.deepEqual(matched.hints, []);
  const kept = matched.scene.children[0];
  assert.ok(kept?.kind === "place" && kept.picture.kind === "picture" && kept.picture.paper.seed === 5);
  const plain = rec.record((v) => v.paper({ seed: 5 }, v.place(v.picture({ key: "plain", width: 4, height: 4 }, () => v.rect(0, 0, 1, 1, FILL)), 0, 0)));
  assert.deepEqual(plain.hints, [], "a picture that reads no paper does not hint");
  const unscoped = testing().record((v) => brushed(v, { seed: 5 }));
  assert.deepEqual(unscoped.hints, [], "a picture with its own paper placed outside any paper scope does not hint");
  const inner = testing().record((v) => v.paper({ seed: 5 }, v.place(v.picture({ key: "inner", width: 4, height: 4 }, () => v.paper({ seed: 5 }, v.line(0, 0, 4, 4, PENCIL))), 0, 0)));
  assert.deepEqual(inner.hints, [], "a picture whose strokes take the outer paper from a scope in its body does not hint");
});

test("a paper scope sets brushed strokes and effects inside it, leaves no node, and is laid out like its children", () => {
  const { scene } = new SceneRecorder({ width: 10, height: 10 }).record((v) => [
    v.rect(0, 0, 1, 1, { ...FILL, effects: { paper: 0.5 } }),
    v.paper({ seed: 4, contrast: 0.2 }, [
      v.line(0, 0, 1, 1, PENCIL),
      v.at({ translate: [1, 1] }, v.rect(0, 0, 1, 1, { ...FILL, effects: { paper: 0.5 } })),
      v.rect(0, 0, 1, 1, FILL),
    ]),
  ]);
  assert.deepEqual(shapeOf(scene.children), ["rect", "line", ["at", ["rect"]], "rect"]);
  const [outside, line, at, plain] = scene.children;
  assert.ok(outside?.kind === "shape" && line?.kind === "shape" && at?.kind === "at" && plain?.kind === "shape");
  const inner = at.children[0];
  assert.ok(inner?.kind === "shape");
  assert.equal(outside.style.effectsPaper?.seed, 1);
  assert.deepEqual(line.style.brush?.paper, { scale: 3, contrast: 0.2, seed: 4 });
  assert.deepEqual(inner.style.effectsPaper, { scale: 3, contrast: 0.2, seed: 4 }, "an effect-only shape gets the scope's paper too");
  assert.equal(plain.style.effectsPaper, undefined);
});

test("keepInside text placed under two transforms is laid out once for each", () => {
  const options = { size: 16, keepInside: true } as const;
  const { scene } = testing({ width: 200, height: 100 }).record((v) => {
    const label = v.text("Label", { x: 180, y: 25 }, options);
    return [v.at({ translate: [0, 0] }, label), v.at({ translate: [-100, 0] }, label)];
  });
  const xs = scene.children.map((n) => (n.kind === "at" && n.children[0]?.kind === "text" ? textX(n.children[0]) : Number.NaN));
  assert.ok(xs[0] !== undefined && xs[1] !== undefined && xs[0] < 180, `kept inside at the right edge: ${xs[0]}`);
  assert.equal(xs[1], 180, "moved left, it fits where it was asked for");
});

function textX(n: TextNode): number {
  return n.lines[0]?.xs[0] ?? Number.NaN;
}

test("made and not returned: a frame node returned by a kept picture's body is drawn on every frame, re-record included", () => {
  const rec = testing();
  const draw = (v: View): Drawing => {
    const outer = v.rect(0, 0, 1, 1, FILL);
    return v.place(v.picture({ key: "kept", width: 4, height: 4 }, () => outer), 0, 0);
  };
  assert.deepEqual(rec.record(draw).warnings, []);
  assert.deepEqual(rec.record(draw).warnings, [], "the second frame re-records the body, which takes the outer node");
});

test("made and not returned: lines warned before do not use up a frame's allowance of 8", () => {
  const rec = testing();
  const drawn: number[] = [];
  for (let frame = 0; frame < 3; frame++) {
    const { warnings } = rec.record((v) => {
      v.rect(0, 0, 1, 1, FILL); v.rect(1, 0, 1, 1, FILL); v.rect(2, 0, 1, 1, FILL); v.rect(3, 0, 1, 1, FILL);
      v.rect(4, 0, 1, 1, FILL); v.rect(5, 0, 1, 1, FILL); v.rect(6, 0, 1, 1, FILL); v.rect(7, 0, 1, 1, FILL);
      v.circle(0, 0, 1, FILL);
      return null;
    });
    drawn.push(warnings.length);
    if (frame === 1) assert.match(warnings.join("\n"), /^v\.circle made a drawing/);
  }
  assert.deepEqual(drawn, [8, 1, 0]);
});
