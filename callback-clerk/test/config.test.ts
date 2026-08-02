import { test } from "tap";
import {
  addBox,
  emptyConfig,
  getActiveBox,
  isBoxEnabled,
  moveBox,
  normalizeConfig,
  removeBox,
  setActiveBox,
} from "../src/domain/config.js";

const boxA = { boxUrl: "https://cb.example.com/main", slug: "main", title: "Main" };
const boxB = { boxUrl: "http://localhost:3210/wt/test1", slug: "test1", title: "Test 1" };

test("addBox enables a box and makes the first one active", async (t) => {
  const config = addBox(emptyConfig(), boxA);
  t.same(config.boxes, [boxA]);
  t.equal(config.activeBoxUrl, boxA.boxUrl);
});

test("addBox keeps the existing active box when adding a second", async (t) => {
  const config = addBox(addBox(emptyConfig(), boxA), boxB);
  t.equal(config.boxes.length, 2);
  t.equal(config.activeBoxUrl, boxA.boxUrl);
});

test("addBox replaces an already-enabled box by boxUrl", async (t) => {
  const updated = { ...boxA, title: "Renamed" };
  const config = addBox(addBox(emptyConfig(), boxA), updated);
  t.equal(config.boxes.length, 1);
  t.equal(getActiveBox(config)?.title, "Renamed");
});

test("removeBox of the active box promotes the first remaining box", async (t) => {
  const config = removeBox(addBox(addBox(emptyConfig(), boxA), boxB), boxA.boxUrl);
  t.same(config.boxes, [boxB]);
  t.equal(config.activeBoxUrl, boxB.boxUrl);
});

test("removeBox of the last box clears the active box", async (t) => {
  const config = removeBox(addBox(emptyConfig(), boxA), boxA.boxUrl);
  t.same(config, emptyConfig());
});

test("setActiveBox switches between enabled boxes", async (t) => {
  const config = setActiveBox(addBox(addBox(emptyConfig(), boxA), boxB), boxB.boxUrl);
  t.equal(getActiveBox(config)?.slug, "test1");
});

test("setActiveBox ignores URLs that aren't enabled", async (t) => {
  const config = setActiveBox(addBox(emptyConfig(), boxA), "https://evil.example.com");
  t.equal(config.activeBoxUrl, boxA.boxUrl);
});

test("isBoxEnabled distinguishes enabled from unknown boxes", async (t) => {
  const config = addBox(emptyConfig(), boxA);
  t.equal(isBoxEnabled(config, boxA.boxUrl), true);
  t.equal(isBoxEnabled(config, boxB.boxUrl), false);
});

test("normalizeConfig round-trips a valid config", async (t) => {
  const config = addBox(addBox(emptyConfig(), boxA), boxB);
  t.same(normalizeConfig(JSON.parse(JSON.stringify(config))), config);
});

test("normalizeConfig collapses garbage to the empty config", async (t) => {
  t.same(normalizeConfig(undefined), emptyConfig());
  t.same(normalizeConfig(null), emptyConfig());
  t.same(normalizeConfig("nonsense"), emptyConfig());
  t.same(normalizeConfig({ workerUrl: "https://old.dropbox.relay" }), emptyConfig());
  t.same(normalizeConfig({ version: 2, boxes: [] }), emptyConfig());
});

test("normalizeConfig drops malformed boxes and repairs activeBoxUrl", async (t) => {
  const config = normalizeConfig({
    version: 1,
    boxes: [boxA, { boxUrl: 42 }, "junk"],
    activeBoxUrl: "https://gone.example.com/old",
  });
  t.same(config.boxes, [boxA]);
  t.equal(config.activeBoxUrl, boxA.boxUrl);
});

test("moveBox reorders the list without touching the active box", async (t) => {
  const config = addBox(addBox(emptyConfig(), boxA), boxB);
  const moved = moveBox(config, { boxUrl: boxB.boxUrl, delta: -1 });
  t.same(moved.boxes.map((b) => b.boxUrl), [boxB.boxUrl, boxA.boxUrl]);
  t.equal(moved.activeBoxUrl, boxA.boxUrl);
});

test("moveBox past either end is a no-op, not a wrap", async (t) => {
  const config = addBox(addBox(emptyConfig(), boxA), boxB);
  t.same(moveBox(config, { boxUrl: boxA.boxUrl, delta: -1 }).boxes, config.boxes);
  t.same(moveBox(config, { boxUrl: boxB.boxUrl, delta: 1 }).boxes, config.boxes);
});

test("moveBox ignores a URL that isn't enabled", async (t) => {
  const config = addBox(emptyConfig(), boxA);
  t.same(moveBox(config, { boxUrl: "https://evil.example.com", delta: 1 }), config);
});
