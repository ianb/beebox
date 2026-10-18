// # boxes-config: hand-editable manifest validation (Track D.4)
//
// `~/.config/beebox/boxes.json` is hand-editable, so `loadBoxesConfig` used to run
// an unguarded `JSON.parse` on it — a typo crashed the CLI with a bare
// `SyntaxError` pointing at nothing useful. It's now validated through a zod
// schema with a named, loud `BoxesConfigParseError` that names the file and
// the problem. See `src/core/box/boxes-config.ts`.
//
// `loadBoxesConfig` takes an optional `configPath` override (tests only, mirrors
// `loadHubConfig`'s explicit-path style) so this test never touches the real
// `~/.config/beebox/boxes.json`.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadBoxesConfig, BoxesConfigParseError } from "../../../src/core/box/boxes-config.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

async function tryLoad(configPath: string): Promise<unknown> {
  try {
    return await loadBoxesConfig(configPath);
  } catch (e) {
    return e;
  }
}

// ## Missing file: treated as an empty manifest, no throw
void test("Missing file: treated as an empty manifest, no throw", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L31
  const box = await makeTmpBox();
  const configPath = path.join(box.root, "boxes.json");
  const missing = await tryLoad(configPath);
  t.check(missing, {
    boxes: [],
  });

  // ## A valid manifest loads

  // doctest:L41
  await fs.writeFile(configPath, JSON.stringify({ boxes: ["/path/to/box-a", "/path/to/box-b"] }));
  const valid = await tryLoad(configPath);
  t.check(valid, {
    boxes: [
      "/path/to/box-a",
      "/path/to/box-b",
    ],
  });

  // ## Invalid JSON is a loud, named error — not a bare SyntaxError

  // doctest:L50
  await fs.writeFile(configPath, "{ not valid json");
  const badJson = await tryLoad(configPath);
  await t.checkText(badJson instanceof BoxesConfigParseError, "true");

  // doctest:L55
  await t.checkText(badJson instanceof BoxesConfigParseError && badJson.configPath === configPath, "true");

  // doctest:L58
  await t.checkText(badJson instanceof BoxesConfigParseError && badJson.message.includes(configPath), "true");

  // ## Valid JSON that doesn't match the schema (wrong shape, unknown key) also throws

  // doctest:L65
  await fs.writeFile(configPath, JSON.stringify({ boxes: "not-an-array" }));
  await t.checkText((await tryLoad(configPath)) instanceof BoxesConfigParseError, "true");

  // doctest:L69
  await fs.writeFile(configPath, JSON.stringify({ boxes: [], extra: true }));
  await t.checkText((await tryLoad(configPath)) instanceof BoxesConfigParseError, "true");
});
