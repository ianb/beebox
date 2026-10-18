// # Registering a box with the hub: `bbx hub add-box`'s edit to `hub.json`
//
// `hub.json` used to be hand-edited on the live server to add a box, which meant
// a bad slug was discovered by the hub refusing to boot — after the file had
// already been replaced. `src/hub/config-edit.ts` turns the edit into a plan
// that is validated through the hub's own loader first, so every rejection
// happens with the live file untouched.

import { test } from "tap";
import { any, instanceOf, str } from "agent-doctest/check";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  planAddBoxToHubConfig,
  applyAddBoxPlan,
  describeAddBoxPlan,
  type AddBoxToHubPlan,
  HubConfigEditError,
} from "../../src/hub/config-edit.js";
import { HubConfigError, loadHubConfig } from "../../src/hub/config.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

/** A fixture hub with one already-registered box, plus a second box on disk
 *  that no slug claims yet. Both are v2 package-layout boxes (`.beebox/box.json` lives
 *  in `content/`, and the config names the package root, which is what the
 *  real server does). Invented slugs only — see docs/example-names.md. */
async function makeFixture() {
  const tmp = await makeTmpBox();
  await tmp.write("boxes/hearth/content/.beebox/box.json", "");
  await tmp.write("boxes/lighthouse/content/.beebox/box.json", "");
  const configPath = path.join(tmp.root, "hub.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        port: 4310,
        host: "127.0.0.1",
        lazy: true,
        idleMs: 1_800_000,
        keepRecent: 1,
        boxes: { hearth: { path: "./boxes/hearth" } },
      },
      null,
      2,
    ) + "\n",
  );
  return { tmp, configPath };
}

async function tryApply(plan: AddBoxToHubPlan): Promise<Error | null> {
  try {
    await applyAddBoxPlan(plan);
    return null;
  } catch (e) {
    if (e instanceof Error) return e;
    throw e;
  }
}

interface PlanArgs {
  configPath: string;
  slug: string;
  boxPath: string;
}

async function tryPlan(args: PlanArgs): Promise<AddBoxToHubPlan | Error> {
  try {
    return await planAddBoxToHubConfig(args);
  } catch (e) {
    if (e instanceof Error) return e;
    throw e;
  }
}

/** A plan that must succeed. */
async function planOk(args: PlanArgs): Promise<AddBoxToHubPlan> {
  const result = await tryPlan(args);
  if (result instanceof Error) throw result;
  return result;
}

/** A plan that must be rejected; returns the rejection. */
async function planRejected(args: PlanArgs): Promise<Error> {
  const result = await tryPlan(args);
  if (!(result instanceof Error)) throw new Error(`expected the plan for ${args.slug} to be rejected`);
  return result;
}

// ## Adding a new box produces a plan, and applying it writes a config the hub loads
//
// The unrelated top-level settings (`port`, `lazy`, `keepRecent`) survive the
// edit — the whole reason the command refuses to invent a config from scratch.
void test("The unrelated top-level settings (port, lazy, keepRecent) survive the edit —...", async (t) => {
  // doctest:L89
  const { tmp, configPath } = await makeFixture();
  const lighthouse = path.join(tmp.root, "boxes/lighthouse");
  const plan = await planOk({ configPath: configPath, slug: "lighthouse", boxPath: path.join(tmp.root, "boxes/lighthouse") });
  t.check(plan.action, "added");

  // doctest:L94
  await applyAddBoxPlan(plan);
  const config = await loadHubConfig(configPath);
  t.check(Object.keys(config.boxes).toSorted(), ["hearth", "lighthouse"]);

  // doctest:L99
  t.check(config.boxes.lighthouse?.path, path.join(tmp.root, "boxes/lighthouse"));

  // doctest:L102
  t.check(
    { port: config.port, host: config.host, lazy: config.lazy, idleMs: config.idleMs, keepRecent: config.keepRecent },
    { port: 4310, host: "127.0.0.1", lazy: true, idleMs: 1_800_000, keepRecent: 1 },
  );

  // ## Re-running is a no-op, not a conflict
  //
  // `deploy/add-box.sh` claims idempotence, so the hub step has to have it too.
  // The already-registered entry uses a relative path and the caller passes an
  // absolute one; the comparison canonicalizes both, so they match.

  // doctest:L113
  const again = await planOk({ configPath: configPath, slug: "lighthouse", boxPath: path.join(tmp.root, "boxes/lighthouse") });
  t.check(again.action, "unchanged");

  // doctest:L117
  t.check(describeAddBoxPlan(again), `Already registered: "lighthouse" -> ${lighthouse} (${configPath} unchanged)`);

  // A stale v2-manifest path — the box's old `content/` subdirectory — is NOT
  // silently unified with the box root anymore (shapeVersion 3 has one root and
  // no `content/` dir). Registering it under the same slug is a conflict the
  // operator must fix, not a no-op:

  // doctest:L127
  const viaContent = await planRejected({ configPath: configPath, slug: "hearth", boxPath: path.join(tmp.root, "boxes/hearth/content") });
  t.check(viaContent, instanceOf(HubConfigEditError));
  t.check(
    viaContent.message,
    `Hub config at ${configPath}: slug "hearth" already routes to ${path.join(tmp.root, "boxes/hearth")}, not ${path.join(tmp.root, "boxes/hearth/content")}. Pick a different slug, or remove the existing entry by hand if the box really moved — repointing a live slug is a decision this command will not make for you.`,
  );

  // ## A reserved slug fails before anything is written
  //
  // `healthz`, `auth`, `webhook`, and `api` are the hub's own prefixes. The plan
  // runs the candidate config through `parseHubConfig`, so this is the same
  // rejection the hub would make at startup — reported now instead.

  // doctest:L139
  const reserved = await planRejected({ configPath: configPath, slug: "webhook", boxPath: path.join(tmp.root, "boxes/lighthouse") });
  t.check(reserved, instanceOf(HubConfigError));

  // doctest:L143
  t.check(
    reserved.message,
    `Hub config at ${configPath}: slug "webhook" is reserved (the box server itself claims that URL prefix — see RESERVED_SLUGS in src/hub/config.ts). Pick a different slug.`,
  );

  // doctest:L146
  t.check(
    // The live file still holds exactly the two boxes from before.
    Object.keys((await loadHubConfig(configPath)).boxes).toSorted(),
    ["hearth", "lighthouse"],
  );

  // A malformed slug is rejected the same way.

  // doctest:L154
  const malformed = await planRejected({ configPath: configPath, slug: "Lighthouse_2", boxPath: path.join(tmp.root, "boxes/lighthouse") });
  t.check(malformed, instanceOf(HubConfigError));
  t.check(malformed.message, `Hub config at ${configPath} is invalid:\n  - boxes.Lighthouse_2: Invalid key in record`);

  // ## A second slug for an already-registered box is refused
  //
  // Two slugs resolving to one box would start two engine processes against one
  // `events.db`. The hub refuses such a config at load; the editor refuses to
  // create it.

  // doctest:L166
  const dupe = await planRejected({ configPath: configPath, slug: "beacon", boxPath: path.join(tmp.root, "boxes/lighthouse") });
  t.check(dupe, instanceOf(HubConfigError));

  // doctest:L170
  t.check(
    dupe.message,
    `Hub config at ${configPath}: the same box path is registered under more than one slug, which would start two engine processes against one box's on-disk state (two engines on one events.db is corrupting, not just wasteful):
  - ${lighthouse} is claimed by slugs: lighthouse (${lighthouse}), beacon (${lighthouse})`,
  );

  // ## Reusing a slug for a different box is refused
  //
  // Repointing a live slug is an operator decision, not something a provisioning
  // script should do silently.

  // doctest:L180
  const repoint = await planRejected({ configPath: configPath, slug: "hearth", boxPath: path.join(tmp.root, "boxes/lighthouse") });
  t.check(repoint, instanceOf(HubConfigEditError));

  // doctest:L184
  t.check(
    repoint.message,
    `Hub config at ${configPath}: slug "hearth" already routes to ${path.join(tmp.root, "boxes/hearth")}, not ${lighthouse}. Pick a different slug, or remove the existing entry by hand if the box really moved — repointing a live slug is a decision this command will not make for you.`,
  );

  // ## A missing config file is an error, not an invented one
  //
  // A config written from scratch would drop the port/host/lazy settings the
  // running hub depends on, so the command names the problem instead.

  // doctest:L194
  const missing = await planRejected({ configPath: path.join(tmp.root, "nope.json"), slug: "lighthouse", boxPath: tmp.root });
  t.check(missing, instanceOf(HubConfigEditError));

  // doctest:L198
  t.check(
    missing.message,
    `No hub config at ${path.join(tmp.root, "nope.json")}. This command registers a box with an existing hub; it deliberately will not invent one, because a config created from scratch would silently drop the port/host/lazy settings the running hub depends on. Create the file first — see docs/server/boxes.md — or pass --config to point at the real one.`,
  );

  // ## A config the hub would refuse is caught on EVERY path, including the no-op one
  //
  // The caller restarts the hub after this command succeeds, so "already
  // registered, nothing to do" against a config the hub cannot load would take the
  // fleet down at the restart. The current config is validated before the addition
  // is even considered.

  // doctest:L210
  const brokenConfigPath = path.join(tmp.root, "hand-broken.json");
  await fs.writeFile(
    brokenConfigPath,
    JSON.stringify({ boxes: { hearth: { path: "./boxes/hearth" }, api: { path: "./boxes/lighthouse" } } }),
  );
  // "hearth" is already registered there at the same path — the idempotent path.
  const onBroken = await planRejected({ configPath: brokenConfigPath, slug: "hearth", boxPath: path.join(tmp.root, "boxes/hearth") });
  t.check(onBroken, instanceOf(HubConfigError));

  // doctest:L220
  t.check(
    onBroken.message,
    `Hub config at ${brokenConfigPath}: slug "api" is reserved (the box server itself claims that URL prefix — see RESERVED_SLUGS in src/hub/config.ts). Pick a different slug.`,
  );

  // ## Applying a plan refuses if the file changed underneath it

  // doctest:L227
  const racePath = path.join(tmp.root, "race.json");
  await fs.writeFile(racePath, JSON.stringify({ boxes: {} }, null, 2) + "\n");
  const racePlan = await planOk({ configPath: racePath, slug: "lighthouse", boxPath: path.join(tmp.root, "boxes/lighthouse") });
  t.check(racePlan.action, "added");

  // doctest:L233
  // Someone else edits the file between the plan and the write.
  await fs.writeFile(racePath, JSON.stringify({ boxes: { beacon: { path: "./boxes/hearth" } } }, null, 2) + "\n");
  const raced = await tryApply(racePlan);
  t.check(raced, instanceOf(HubConfigEditError));
  t.check(
    raced?.message,
    `Hub config at ${racePath} changed while this edit was being prepared. Nothing was written — re-run the command against the current file.`,
  );

  // doctest:L238
  t.check(
    // The other writer's version survives.
    Object.keys((await loadHubConfig(racePath)).boxes),
    ["beacon"],
  );

  // ## An unparseable config is an error, not a clobber

  // doctest:L246
  const brokenPath = path.join(tmp.root, "broken.json");
  await fs.writeFile(brokenPath, "{ this is not json");
  const broken = await planRejected({ configPath: brokenPath, slug: "lighthouse", boxPath: path.join(tmp.root, "boxes/lighthouse") });
  t.check(broken, instanceOf(HubConfigEditError));

  // doctest:L252
  t.check(
    broken.message,
    str`Hub config at ${brokenPath} is not valid JSON, so it cannot be edited safely: ${any(String)}`,
  );

  // doctest:L255
  await t.checkText(
    // Untouched.
    await fs.readFile(brokenPath, "utf-8"),
    "{ this is not json",
  );
});
