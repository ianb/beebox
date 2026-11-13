// Preparing a release: it copies the named stage members without any
// node_modules, carries the deploy history forward with the new entry first,
// and retries an install the kernel killed, but no other failure.
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ReleaseRefusedError } from "../../../src/scripts/deploy-releases/layout.js";
import { prepareRelease, type InstallOptions } from "../../../src/scripts/deploy-releases/prepare.js";
import { makeHost, type Host } from "./fixture.js";

function makeStage(host: Host): string {
  const stage = path.join(host.root, "stage");
  fs.mkdirSync(path.join(stage, "beebox", "node_modules", "stale"), { recursive: true });
  fs.mkdirSync(path.join(stage, "browse"));
  fs.writeFileSync(path.join(stage, "beebox", "deploy-info.json"), JSON.stringify({ requestedRef: "new" }));
  fs.writeFileSync(path.join(stage, "package.json"), "{}");
  return stage;
}

const MAKE_MODULES: InstallOptions = { command: ["sh", "-c", "mkdir node_modules"], retryDelaysMs: [] };

void test("a release holds only the named members and the history gains the new entry first", async (t) => {
  const host = makeHost();
  t.teardown(host.cleanup);
  const stage = makeStage(host);
  fs.mkdirSync(path.join(host.layout.installDir, "beebox"), { recursive: true });
  const old = Array.from({ length: 25 }, (_, i) => ({ requestedRef: `old-${String(i)}` }));
  fs.writeFileSync(path.join(host.layout.installDir, "beebox", "deploy-history.json"), JSON.stringify(old));

  const release = prepareRelease(host.layout, { stage, name: "r1", members: ["beebox", "package.json"], install: MAKE_MODULES });

  const history: unknown = JSON.parse(fs.readFileSync(path.join(release, "beebox", "deploy-history.json"), "utf8"));
  t.check({
    entries: fs.readdirSync(release).toSorted(),
    beebox: fs.readdirSync(path.join(release, "beebox")).toSorted(),
    history: Array.isArray(history) ? { length: history.length, first: history[0], last: history.at(-1) } : null,
  }, {
    entries: ["beebox", "node_modules", "package.json"],
    beebox: ["deploy-history.json", "deploy-info.json"],
    history: { length: 20, first: { requestedRef: "new" }, last: { requestedRef: "old-18" } },
  });
});

void test("an install killed once is retried; any other failure is not", async (t) => {
  const host = makeHost();
  t.teardown(host.cleanup);
  const stage = makeStage(host);
  const killedOnce: InstallOptions = {
    command: ["sh", "-c", "if [ -e ../killed ]; then mkdir node_modules; else touch ../killed; exit 137; fi"],
    retryDelaysMs: [0],
  };
  const release = prepareRelease(host.layout, { stage, name: "r1", members: ["beebox"], install: killedOnce });
  t.check(fs.existsSync(path.join(release, "node_modules")), true);

  const broken: InstallOptions = { command: ["sh", "-c", "exit 1"], retryDelaysMs: [0, 0] };
  await t.checkThrows(() => prepareRelease(host.layout, { stage, name: "r2", members: ["beebox"], install: broken }), "InstallFailedError");
  const alwaysKilled: InstallOptions = { command: ["sh", "-c", "exit 137"], retryDelaysMs: [0] };
  await t.checkThrows(() => prepareRelease(host.layout, { stage, name: "r3", members: ["beebox"], install: alwaysKilled }), "InstallFailedError");
});

void test("a missing member, a missing deploy-info, or a reused name refuses before installing", async (t) => {
  const host = makeHost();
  t.teardown(host.cleanup);
  const stage = makeStage(host);
  const kinds = (fn: () => unknown): string => {
    try {
      fn();
      return "no refusal";
    } catch (e) {
      if (e instanceof ReleaseRefusedError) return e.refusal.kind;
      throw e;
    }
  };
  const prepare = (name: string, members: string[]) => () => prepareRelease(host.layout, { stage, name, members, install: MAKE_MODULES });
  t.check(kinds(prepare("r1", ["canvas-loop"])), "missing-member");
  t.check(kinds(prepare("r2", ["package.json"])), "deploy-info");
  t.check(kinds(prepare("previous", ["beebox"])), "invalid-name");
});
