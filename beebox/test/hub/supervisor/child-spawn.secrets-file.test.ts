// # A box with its own secret store gets only that store
//
// The dev router gives a test box its own store (`TEST_BOXES=`), written as
// `secretsFile` in `hub.json`. The hub passes it to that box's child as
// `BBX_SECRETS_FILE`, marked isolated; a box without one inherits the hub's
// store. Config resolution and the child env are both checked; the spawn
// records the env and runs a no-op node in place of `bbx engine serve`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadHubConfig } from "../../../src/hub/config.js";
import { defaultSpawnChild, spawnBoxChild, type SpawnChildFn } from "../../../src/hub/supervisor/child-spawn.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

void test("secretsFile resolves against the config and reaches only its own box's child", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());

  const configPath = path.join(box.root, "..", `hub-${path.basename(box.root)}.json`);
  await fs.writeFile(configPath, JSON.stringify({ boxes: { test1: { path: box.root, secretsFile: "./stores/test1.json" } } }));
  t.teardown(() => fs.rm(configPath, { force: true }));
  const config = await loadHubConfig(configPath);
  const ownStore = path.join(path.dirname(configPath), "stores", "test1.json");
  t.check(config.boxes.test1?.secretsFile, ownStore);

  // Record the env, then run a no-op node in place of `bbx engine serve`.
  const seen: NodeJS.ProcessEnv[] = [];
  const children: ReturnType<SpawnChildFn>[] = [];
  const spawn: SpawnChildFn = (params) => {
    seen.push(params.env);
    const child = defaultSpawnChild({ ...params, bbxBinary: process.execPath, args: ["-e", ""] });
    child.catch(() => {});
    children.push(child);
    return child;
  };
  t.teardown(() => Promise.allSettled(children));

  await spawnBoxChild({ root: box.root, slug: "test1", hubSecret: "h", spawn, secretsFile: ownStore });
  await spawnBoxChild({ root: box.root, slug: "own", hubSecret: "h", spawn });

  t.check({ file: seen[0]?.BBX_SECRETS_FILE, isolated: seen[0]?.BBX_SECRETS_STORE_ISOLATED }, { file: ownStore, isolated: "1" });
  t.check({ file: seen[1]?.BBX_SECRETS_FILE, isolated: seen[1]?.BBX_SECRETS_STORE_ISOLATED }, { file: process.env.BBX_SECRETS_FILE, isolated: process.env.BBX_SECRETS_STORE_ISOLATED });
});
