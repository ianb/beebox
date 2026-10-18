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
import { instanceOf, str } from "agent-doctest/check";
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
  const box = await makeTmpBox();
  const configPath = path.join(box.root, "boxes.json");
  const missing = await tryLoad(configPath);
  t.check(missing, {
    boxes: [],
  });

  // ## A valid manifest loads

  await fs.writeFile(configPath, JSON.stringify({ boxes: ["/path/to/box-a", "/path/to/box-b"] }));
  const valid = await tryLoad(configPath);
  t.check(valid, {
    boxes: [
      "/path/to/box-a",
      "/path/to/box-b",
    ],
  });

  // ## Invalid JSON is a loud, named error — not a bare SyntaxError

  await fs.writeFile(configPath, "{ not valid json");
  const badJson = await tryLoad(configPath);
  t.check(badJson, instanceOf(BoxesConfigParseError));

  t.check(badJson, {
    name: "BoxesConfigParseError",
    message: str`Box manifest at ${configPath} is invalid: Expected property name or '}' in JSON at position 2 (line 1 column 3). Fix or delete the file by hand.`,
    configPath,
  });


  // ## Valid JSON that doesn't match the schema (wrong shape, unknown key) also throws

  await fs.writeFile(configPath, JSON.stringify({ boxes: "not-an-array" }));
  t.check(await tryLoad(configPath), instanceOf(BoxesConfigParseError));

  await fs.writeFile(configPath, JSON.stringify({ boxes: [], extra: true }));
  t.check(await tryLoad(configPath), instanceOf(BoxesConfigParseError));
});
