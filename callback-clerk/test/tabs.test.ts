import { test } from "tap";
import { toTabInfoList } from "../src/lib/tabs.js";

test("toTabInfoList filters out tabs without id", async (t) => {
  const result = toTabInfoList([
    { id: 1, windowId: 1, url: "https://a.com", title: "A", active: true, pinned: false },
    { windowId: 1, url: "https://b.com", title: "B", active: false, pinned: false },
  ]);
  t.equal(result.length, 1);
  t.equal(result[0].url, "https://a.com");
});

test("toTabInfoList filters out tabs without url", async (t) => {
  const result = toTabInfoList([
    { id: 1, windowId: 1, url: "https://a.com", title: "A", active: true, pinned: false },
    { id: 2, windowId: 1, title: "B", active: false, pinned: false },
  ]);
  t.equal(result.length, 1);
  t.equal(result[0].id, 1);
});

test("toTabInfoList maps all fields correctly", async (t) => {
  const result = toTabInfoList([
    { id: 42, windowId: 3, url: "https://example.com", title: "Example", active: true, pinned: true },
  ]);
  t.equal(result.length, 1);
  t.same(result[0], {
    id: 42,
    windowId: 3,
    url: "https://example.com",
    title: "Example",
    active: true,
    pinned: true,
  });
});

test("toTabInfoList handles empty array", async (t) => {
  const result = toTabInfoList([]);
  t.same(result, []);
});

test("toTabInfoList defaults missing title to empty string", async (t) => {
  const result = toTabInfoList([
    { id: 1, windowId: 1, url: "https://a.com", active: false, pinned: false },
  ]);
  t.equal(result[0].title, "");
});
