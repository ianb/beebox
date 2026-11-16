// # Figure rendering on the server: Dawn and a Vulkan driver
//
// `bbx figure run` renders with canvas-loop, which the CLI bundle inlines while
// canvas-loop's own npm dependencies stay external (src/scripts/build-cli/build/bundle.ts).
// So beebox must declare each of them, or a packed install fails at the first
// figure run. Dawn needs a Vulkan driver on Linux: every deploy installs Mesa's
// and proves Dawn finds an adapter as a box user.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { readFile } from "node:fs/promises";
import { isRecord } from "../../src/shared/is-record.js";

async function dependencies(file: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  const deps = isRecord(parsed) ? parsed["dependencies"] : undefined;
  return isRecord(deps) ? deps : {};
}

const helper = await readFile("deploy/server-bin/bbx-figure-gpu-install", "utf8");
const deploy = await readFile("deploy/deploy.sh", "utf8");
const cloudInit = await readFile("deploy/hetzner/cloud-init.yaml", "utf8");
const dockerfile = await readFile("docker/Dockerfile", "utf8");

void test("beebox declares every runtime dependency of canvas-loop at the same version", async (t) => {
  const canvasLoop = await dependencies("../canvas-loop/package.json");
  const beebox = await dependencies("package.json");
  // Read from the file, so the check below cannot pass on an empty list.
  t.check(Object.keys(canvasLoop).toSorted(), ["@napi-rs/canvas", "webgpu", "yaml"]);
  t.check(
    Object.fromEntries(Object.keys(canvasLoop).map((name) => [name, beebox[name]])),
    canvasLoop,
  );
});

void test("Every deploy installs Mesa's Vulkan driver and probes Dawn as a box user", (t) => {
  t.check(deploy, any(String).includes('< "$CHECKOUT/beebox/deploy/server-bin/bbx-figure-gpu-install"'));
  t.check(helper, any(String).includes("apt-get install -y -qq mesa-vulkan-drivers"));
  t.check(helper, any(String).includes("src/scripts/dawn-probe.ts"));
  t.check(cloudInit, any(String).includes("\n  - mesa-vulkan-drivers\n"));
  t.check(dockerfile, any(String).includes(" mesa-vulkan-drivers"));
  t.end();
});

// pnpm 12 fails an install on a build script it was not told to run or skip,
// and webgpu has one. The image's engine install names it in allowBuilds.
void test("The image's engine install names webgpu's build script in allowBuilds", (t) => {
  t.check(dockerfile, any(String).includes("'  webgpu: false'"));
  t.end();
});

// A packed install has no canvas-loop source; build:declarations ships its
// root-export declarations and tsconfig for the sketch contract check.
void test("The packed engine ships canvas-loop's declarations for the sketch check", async (t) => {
  const scripts = JSON.parse(await readFile("package.json", "utf8")).scripts;
  t.check(scripts["build:declarations"], any(String).includes("tsc -p tsconfig.declarations.canvas-loop.json && cp ../canvas-loop/tsconfig.json dist/canvas-loop/tsconfig.json"));
});
