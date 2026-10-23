// # `bbx hub` config: `hub.json` validation (Track D, chunk D1)
//
// `hub.json` is the fleet's routing table, so it's validated fail-closed:
// unknown top-level keys, an unknown per-box key, a malformed or reserved
// slug, and two slugs claiming the same box path are all load errors, not
// warnings. See `src/hub/config.ts`.

import { test } from "tap";
import { any, instanceOf, str } from "@ianbicking/tap-check/check";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadHubConfig, HubConfigError, type HubConfig } from "../../src/hub/config.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

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
  const box = await makeTmpBox();
  await box.write("boxes/test1/.beebox/box.json", "");
  const configPath = await writeConfig(box.root, { boxes: { test1: { path: "./boxes/test1" } } });
  const config = await loadOk(configPath);

  t.check(config, {
    port: undefined,
    host: undefined,
    boxes: { test1: { path: path.join(box.root, "boxes/test1") } },
    configPath,
    lazy: false,
    idleMs: 300_000,
    keepRecent: 0,
  });

  // ## An unknown top-level key is rejected (fail-closed, `z.strictObject`)

  const badConfig = await writeConfig(box.root, { boxes: {}, extraKey: true });
  const err = await loadRejected(badConfig);
  t.check(err, instanceOf(HubConfigError));
  // The text after the path is zod's; the check keeps our prefix, the path, and the key it names.
  t.check(err.message, str`Hub config at ${badConfig} is invalid:\n  - (root): ${any(String).includes('"extraKey"')}`);

  // ## An unknown key inside a box entry is rejected

  const badEntry = await writeConfig(box.root, { boxes: { test1: { path: "./boxes/test1", port: 1234 } } });
  const badEntryErr = await loadRejected(badEntry);
  t.check(badEntryErr, instanceOf(HubConfigError));
  t.check(badEntryErr.message, str`Hub config at ${badEntry} is invalid:\n  - boxes.test1: ${any(String).includes('"port"')}`);

  // ## A reserved slug is rejected
  //
  // `healthz`, `auth`, `webhook`, and `api` are prefixes the box server itself
  // claims at the root level (or, for `webhook`, as a SEPARATE top-level prefix
  // from a box's own `/<slug>` — see `RESERVED_SLUGS`'s doc comment) — a box
  // slugged the same would make some of its own routes unreachable through the
  // hub.

  const reservedConfig = await writeConfig(box.root, { boxes: { webhook: { path: "./boxes/test1" } } });
  const err2 = await loadRejected(reservedConfig);
  t.check(err2, instanceOf(HubConfigError));
  t.check(
    err2.message,
    `Hub config at ${reservedConfig}: slug "webhook" is reserved (the box server itself claims that URL prefix — see RESERVED_SLUGS in src/hub/config.ts). Pick a different slug.`,
  );

  // ## A malformed slug (uppercase, leading hyphen, empty) is rejected

  const badSlug = await writeConfig(box.root, { boxes: { "Test-1": { path: "./boxes/test1" } } });
  const badSlugErr = await loadRejected(badSlug);
  t.check(badSlugErr, instanceOf(HubConfigError));
  t.check(badSlugErr.message, str`Hub config at ${badSlug} is invalid:\n  - boxes.Test-1: ${any(String)}`);

  // ## Two slugs claiming the same resolved box path is rejected
  //
  // Two engine processes serving one box's on-disk state at once is the exact
  // "critical gap" the plan's Failure modes section warns about (two engines on
  // one `events.db`) — the hub must never be configured to do this on purpose.

  const dupeConfig = await writeConfig(box.root, {
    boxes: {
      test1: { path: "./boxes/test1" },
      "test1-again": { path: "./boxes/test1" },
    },
  });
  const dupeErr = await loadRejected(dupeConfig);
  t.check(dupeErr, instanceOf(HubConfigError));
  const test1Path = path.join(box.root, "boxes/test1");
  t.check(
    dupeErr.message,
    `Hub config at ${dupeConfig}: the same box path is registered under more than one slug, which would start two engine processes against one box's on-disk state (two engines on one events.db is corrupting, not just wasteful):
  - ${test1Path} is claimed by slugs: test1 (${test1Path}), test1-again (${test1Path})`,
  );

  // ## A symlinked alias to the same box is caught (canonicalized before comparing)
  //
  // Without canonicalizing to the actual box root first, two differently-spelled
  // paths to the same box could compare as different strings and both pass the
  // check -- exactly the "two engines on one `events.db`" hazard above.
  // `resolveBoxRoot` (the same resolution `src/hub/supervisor/core.ts` uses at boot)
  // resolves both, and `fs.realpath` catches a symlinked alias, before the
  // duplicate check runs.

  await fs.symlink(path.join(box.root, "boxes/test1"), path.join(box.root, "boxes/test1-link"));
  const symlinkConfig = await writeConfig(box.root, {
    boxes: {
      test1: { path: "./boxes/test1" },
      "test1-symlink": { path: "./boxes/test1-link" },
    },
  });
  const symlinkErr = await loadRejected(symlinkConfig);
  t.check(symlinkErr, instanceOf(HubConfigError));
  t.check(
    symlinkErr.message,
    `Hub config at ${symlinkConfig}: the same box path is registered under more than one slug, which would start two engine processes against one box's on-disk state (two engines on one events.db is corrupting, not just wasteful):
  - ${test1Path} is claimed by slugs: test1 (${test1Path}), test1-symlink (${path.join(box.root, "boxes/test1-link")})`,
  );

  // ## Legacy box state resolves, but config loading does not migrate it
  //
  // The router and hub need to locate a box before `getBoxShape()` can run the
  // engine-owned migration. A legacy `content/.callback-box` therefore identifies
  // the operational root, but discovery itself must leave it in place so an older
  // worktree can still be served without the router rewriting its state.

  const legacyState = path.join(box.root, "boxes/legacy/content/.callback-box");
  await fs.mkdir(legacyState, { recursive: true });
  await fs.writeFile(path.join(legacyState, "state.json"), "old\n");
  const legacyConfigPath = await writeConfig(box.root, { boxes: { legacy: { path: "./boxes/legacy" } } });
  const legacyConfig = await loadHubConfig(legacyConfigPath);
  t.check(legacyConfig, {
    port: undefined,
    host: undefined,
    boxes: { legacy: { path: path.join(box.root, "boxes/legacy") } },
    configPath: legacyConfigPath,
    lazy: false,
    idleMs: 300_000,
    keepRecent: 0,
  });

  t.check(await fs.readdir(path.join(box.root, "boxes/legacy/content")), [path.basename(legacyState)]);

  // A box path that doesn't resolve at all (no `.beebox/box.json` anywhere) still loads
  // successfully -- canonicalization failures don't block config load, only the
  // supervisor reports that box "unhealthy" once it actually tries to launch it
  // (see `cli/commands/hub.ts`'s best-effort `boxEntries` handling):

  const unresolvableConfig = await writeConfig(box.root, { boxes: { broken: { path: "./boxes/does-not-exist" } } });
  t.check(await loadOk(unresolvableConfig), {
    port: undefined,
    host: undefined,
    boxes: { broken: { path: path.join(box.root, "boxes/does-not-exist") } },
    configPath: unresolvableConfig,
    lazy: false,
    idleMs: 300_000,
    keepRecent: 0,
  });
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
  const missing = await loadRejected("/nonexistent/hub.json");
  t.check(missing, instanceOf(HubConfigError));
  // The cause text after the path is Node's; ENOENT is the part the message must carry.
  t.check(missing.message, str`Cannot read hub config at /nonexistent/hub.json: ${any(String).startsWith("ENOENT")}`);

  const box2 = await makeTmpBox();
  const notJson = path.join(box2.root, "hub.json");
  await fs.writeFile(notJson, "{ not json");
  const notJsonErr = await loadRejected(notJson);
  t.check(notJsonErr, instanceOf(HubConfigError));
  t.check(notJsonErr.message, str`Hub config at ${notJson} is not valid JSON: ${any(String)}`);
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
  const box3 = await makeTmpBox();
  await box3.write("boxes/test1/.beebox/box.json", "");
  const plainConfigPath = await writeConfig(box3.root, { boxes: { test1: { path: "./boxes/test1" } } });
  const plainConfig = await loadHubConfig(plainConfigPath);
  t.check({ lazy: plainConfig.lazy, idleMs: plainConfig.idleMs }, {
    lazy: false,
    idleMs: 300000,
  });

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

  const keepConfigPath = await writeConfig(box3.root, {
    boxes: { test1: { path: "./boxes/test1" } },
    lazy: true,
    keepRecent: 2,
  });
  t.check((await loadHubConfig(keepConfigPath)).keepRecent, 2);

  // `keepRecent > 0` without `lazy: true` is rejected, and the message names the
  // constraint:

  const keepNoLazyPath = await writeConfig(box3.root, {
    boxes: { test1: { path: "./boxes/test1" } },
    keepRecent: 1,
  });
  const keepErr = await loadRejected(keepNoLazyPath);
  t.check(keepErr, instanceOf(HubConfigError));
  t.check(
    keepErr.message,
    `Hub config at ${keepNoLazyPath}: keepRecent (1) requires lazy: true. It keeps the most-recently-used boxes alive in an otherwise idle-stopping lazy hub, which is meaningless for a resident (non-lazy) hub where every box already stays up. Set lazy: true, or remove keepRecent.`,
  );

  // `keepRecent: 0` without `lazy` is fine (it's the default — nothing to keep):

  const keepZeroPath = await writeConfig(box3.root, {
    boxes: { test1: { path: "./boxes/test1" } },
    keepRecent: 0,
  });
  t.check(await loadOk(keepZeroPath), {
    port: undefined,
    host: undefined,
    boxes: { test1: { path: path.join(box3.root, "boxes/test1") } },
    configPath: keepZeroPath,
    lazy: false,
    idleMs: 300_000,
    keepRecent: 0,
  });

  // A negative or non-integer `keepRecent` is a schema error:

  const keepNegPath = await writeConfig(box3.root, {
    boxes: { test1: { path: "./boxes/test1" } },
    lazy: true,
    keepRecent: -1,
  });
  const keepNegPathErr = await loadRejected(keepNegPath);
  t.check(keepNegPathErr, instanceOf(HubConfigError));
  t.check(keepNegPathErr.message, str`Hub config at ${keepNegPath} is invalid:\n  - keepRecent: ${any(String)}`);
});
