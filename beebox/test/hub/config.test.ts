// # `bbx hub` config: `hub.json` validation (Track D, chunk D1)
//
// `hub.json` is the fleet's routing table, so it's validated fail-closed:
// unknown top-level keys, an unknown per-box key, a malformed or reserved
// slug, and two slugs claiming the same box path are all load errors, not
// warnings. See `src/hub/config.ts`.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadHubConfig, HubConfigError, type HubConfig } from "../../src/hub/config.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function writeConfig(dir: string, obj: object): Promise<string> {
  const configPath = path.join(dir, "hub.json");
  await fs.writeFile(configPath, JSON.stringify(obj, null, 2));
  return configPath;
}

async function tryLoad(configPath: string): Promise<HubConfig | Error> {
  try {
    return await loadHubConfig(configPath);
  } catch (e) {
    if (e instanceof Error) return e;
    throw e;
  }
}

/** A load that must succeed. */
async function loadOk(configPath: string): Promise<HubConfig> {
  const result = await tryLoad(configPath);
  if (result instanceof Error) throw result;
  return result;
}

/** A load that must fail; returns the error. */
async function loadRejected(configPath: string): Promise<Error> {
  const result = await tryLoad(configPath);
  if (!(result instanceof Error)) throw new Error(`expected ${configPath} to be rejected`);
  return result;
}

// ## A minimal valid config loads, with the box path resolved to absolute
void test("A minimal valid config loads, with the box path resolved to absolute", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L47
  const box = await makeTmpBox();
  await box.write("boxes/test1/.beebox/box.json", "");
  const configPath = await writeConfig(box.root, { boxes: { test1: { path: "./boxes/test1" } } });
  const config = await loadOk(configPath);
  await t.checkText(config instanceof HubConfigError, "false");

  // doctest:L54
  await t.checkText(config.boxes.test1?.path === path.join(box.root, "boxes/test1"), "true");

  // ## An unknown top-level key is rejected (fail-closed, `z.strictObject`)

  // doctest:L61
  const badConfig = await writeConfig(box.root, { boxes: {}, extraKey: true });
  const err = await loadRejected(badConfig);
  await t.checkText(err instanceof HubConfigError, "true");

  // doctest:L66
  await t.checkText(err.message.includes("extraKey"), "true");

  // ## An unknown key inside a box entry is rejected

  // doctest:L73
  const badEntry = await writeConfig(box.root, { boxes: { test1: { path: "./boxes/test1", port: 1234 } } });
  await t.checkText((await tryLoad(badEntry)) instanceof HubConfigError, "true");

  // ## A reserved slug is rejected
  //
  // `healthz`, `auth`, `webhook`, and `api` are prefixes the box server itself
  // claims at the root level (or, for `webhook`, as a SEPARATE top-level prefix
  // from a box's own `/<slug>` — see `RESERVED_SLUGS`'s doc comment) — a box
  // slugged the same would make some of its own routes unreachable through the
  // hub.

  // doctest:L87
  const reservedConfig = await writeConfig(box.root, { boxes: { webhook: { path: "./boxes/test1" } } });
  const err2 = await loadRejected(reservedConfig);
  await t.checkText(err2 instanceof HubConfigError, "true");

  // doctest:L92
  await t.checkText(err2.message.includes("reserved"), "true");

  // ## A malformed slug (uppercase, leading hyphen, empty) is rejected

  // doctest:L99
  const badSlug = await writeConfig(box.root, { boxes: { "Test-1": { path: "./boxes/test1" } } });
  await t.checkText((await tryLoad(badSlug)) instanceof HubConfigError, "true");

  // ## Two slugs claiming the same resolved box path is rejected
  //
  // Two engine processes serving one box's on-disk state at once is the exact
  // "critical gap" the plan's Failure modes section warns about (two engines on
  // one `events.db`) — the hub must never be configured to do this on purpose.

  // doctest:L111
  const dupeConfig = await writeConfig(box.root, {
    boxes: {
      test1: { path: "./boxes/test1" },
      "test1-again": { path: "./boxes/test1" },
    },
  });
  const dupeErr = await loadRejected(dupeConfig);
  await t.checkText(dupeErr instanceof HubConfigError, "true");

  // doctest:L121
  await t.checkText(dupeErr.message.includes("test1-again"), "true");

  // ## A symlinked alias to the same box is caught (canonicalized before comparing)
  //
  // Without canonicalizing to the actual box root first, two differently-spelled
  // paths to the same box could compare as different strings and both pass the
  // check -- exactly the "two engines on one `events.db`" hazard above.
  // `resolveBoxRoot` (the same resolution `src/hub/supervisor/core.ts` uses at boot)
  // resolves both, and `fs.realpath` catches a symlinked alias, before the
  // duplicate check runs.

  // doctest:L135
  await fs.symlink(path.join(box.root, "boxes/test1"), path.join(box.root, "boxes/test1-link"));
  const symlinkConfig = await writeConfig(box.root, {
    boxes: {
      test1: { path: "./boxes/test1" },
      "test1-symlink": { path: "./boxes/test1-link" },
    },
  });
  const symlinkErr = await loadRejected(symlinkConfig);
  await t.checkText(symlinkErr instanceof HubConfigError, "true");

  // doctest:L146
  await t.checkText(symlinkErr.message.includes("test1-symlink"), "true");

  // ## Legacy box state resolves, but config loading does not migrate it
  //
  // The router and hub need to locate a box before `getBoxShape()` can run the
  // engine-owned migration. A legacy `content/.callback-box` therefore identifies
  // the operational root, but discovery itself must leave it in place so an older
  // worktree can still be served without the router rewriting its state.

  // doctest:L158
  const legacyState = path.join(box.root, "boxes/legacy/content/.callback-box");
  await fs.mkdir(legacyState, { recursive: true });
  await fs.writeFile(path.join(legacyState, "state.json"), "old\n");
  const legacyConfigPath = await writeConfig(box.root, { boxes: { legacy: { path: "./boxes/legacy" } } });
  const legacyConfig = await loadHubConfig(legacyConfigPath);
  await t.checkText(legacyConfig.boxes.legacy?.path === path.join(box.root, "boxes/legacy"), "true");

  // doctest:L166
  t.check(await fs.access(legacyState).then(() => true), true);

  // doctest:L169
  t.check(await fs.access(path.join(box.root, "boxes/legacy/content/.beebox")).then(() => false, () => true), true);

  // A box path that doesn't resolve at all (no `.beebox/box.json` anywhere) still loads
  // successfully -- canonicalization failures don't block config load, only the
  // supervisor reports that box "unhealthy" once it actually tries to launch it
  // (see `cli/commands/hub.ts`'s best-effort `boxEntries` handling):

  // doctest:L179
  const unresolvableConfig = await writeConfig(box.root, { boxes: { broken: { path: "./boxes/does-not-exist" } } });
  await t.checkText((await tryLoad(unresolvableConfig)) instanceof HubConfigError, "false");
});

// ## Missing config file, invalid JSON
void test("Missing config file, invalid JSON", async (t) => {
  t.teardown(async () => {
    try {
      await box2.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L191
  const missing = await tryLoad("/nonexistent/hub.json");
  await t.checkText(missing instanceof HubConfigError, "true");

  // doctest:L197
  const box2 = await makeTmpBox();
  const notJson = path.join(box2.root, "hub.json");
  await fs.writeFile(notJson, "{ not json");
  await t.checkText((await tryLoad(notJson)) instanceof HubConfigError, "true");
});

// ## `lazy`/`idleMs` default off, and parse when set
//
// Boxholder directive (2026-07-04): `lazy` defaults to `false` (production
// hubs stay resident) and `idleMs` always resolves to a real number (the dev
// router's own 5-minute default) even when the config omits it, so callers
// never need a second fallback.
void test("Boxholder directive (2026-07-04):", async (t) => {
  t.teardown(async () => {
    try {
      await box3.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L216
  const box3 = await makeTmpBox();
  await box3.write("boxes/test1/.beebox/box.json", "");
  const plainConfigPath = await writeConfig(box3.root, { boxes: { test1: { path: "./boxes/test1" } } });
  const plainConfig = await loadHubConfig(plainConfigPath);
  t.check({ lazy: plainConfig.lazy, idleMs: plainConfig.idleMs }, {
    lazy: false,
    idleMs: 300000,
  });

  // doctest:L225
  const lazyConfigPath = await writeConfig(box3.root, {
    boxes: { test1: { path: "./boxes/test1" } },
    lazy: true,
    idleMs: 60000,
  });
  const lazyConfig = await loadHubConfig(lazyConfigPath);
  t.check({ lazy: lazyConfig.lazy, idleMs: lazyConfig.idleMs }, {
    lazy: true,
    idleMs: 60000,
  });

  // ## `keepRecent` parses with `lazy` and requires `lazy: true`
  //
  // Boxholder directive (2026-07-11): `keepRecent` keeps the N most-recently-used
  // boxes alive in an otherwise idle-stopping lazy hub (and pre-starts them on a
  // hub restart). It defaults to 0 (pure idle-stop) and is only meaningful with
  // `lazy: true` — a positive value on a resident hub is a fail-closed config
  // error, since every box there already stays up.

  // doctest:L244
  const keepConfigPath = await writeConfig(box3.root, {
    boxes: { test1: { path: "./boxes/test1" } },
    lazy: true,
    keepRecent: 2,
  });
  t.check((await loadHubConfig(keepConfigPath)).keepRecent, 2);

  // `keepRecent > 0` without `lazy: true` is rejected, and the message names the
  // constraint:

  // doctest:L257
  const keepNoLazyPath = await writeConfig(box3.root, {
    boxes: { test1: { path: "./boxes/test1" } },
    keepRecent: 1,
  });
  const keepErr = await loadRejected(keepNoLazyPath);
  await t.checkText(keepErr instanceof HubConfigError, "true");

  // doctest:L265
  await t.checkText(keepErr.message.includes("keepRecent") && keepErr.message.includes("lazy"), "true");

  // `keepRecent: 0` without `lazy` is fine (it's the default — nothing to keep):

  // doctest:L272
  const keepZeroPath = await writeConfig(box3.root, {
    boxes: { test1: { path: "./boxes/test1" } },
    keepRecent: 0,
  });
  await t.checkText((await tryLoad(keepZeroPath)) instanceof HubConfigError, "false");

  // A negative or non-integer `keepRecent` is a schema error:

  // doctest:L283
  const keepNegPath = await writeConfig(box3.root, {
    boxes: { test1: { path: "./boxes/test1" } },
    lazy: true,
    keepRecent: -1,
  });
  await t.checkText((await tryLoad(keepNegPath)) instanceof HubConfigError, "true");
});
