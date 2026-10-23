// # loadJsonStateOrFresh
//
// For state whose loss only costs repeated work (chat review, retro, the todo
// review sweep): anything short of a valid file gives the fresh value, and
// every case but a missing file warns. See `src/lib/json-state.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { loadJsonStateOrFresh } from "../../src/lib/json-state.js";

void test("Valid state loads; missing, invalid, or wrong-shaped state is fresh, warning on all but missing", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "json-state-"));
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: unknown) => { warnings.push(String(message)); };
  t.teardown(() => {
    console.warn = warn;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const load = (file: string) => loadJsonStateOrFresh({
    filePath: path.join(dir, file),
    name: file,
    label: "demo",
    schema: z.object({ count: z.number() }),
    fresh: () => ({ count: 0 }),
  });
  fs.writeFileSync(path.join(dir, "good.json"), '{"count":3}');
  fs.writeFileSync(path.join(dir, "broken.json"), "{");
  fs.writeFileSync(path.join(dir, "shape.json"), '{"count":"3"}');
  t.check(await Promise.all(["good.json", "missing.json", "broken.json", "shape.json"].map(load)), [
    { count: 3 }, { count: 0 }, { count: 0 }, { count: 0 },
  ]);
  t.check(warnings.toSorted(), [
    "demo: broken.json is not valid JSON, starting fresh:",
    "demo: shape.json did not match the expected shape, starting fresh",
  ]);
});
