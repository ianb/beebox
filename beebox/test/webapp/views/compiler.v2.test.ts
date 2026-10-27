// # Views compiler: v3 (one-root, package-shaped) boxes
//
// A v3 box has one root — `package.json` (recording `shapeVersion: 3`) and
// `_config/` sit alongside a real `node_modules/beebox` dependency. Its views live at
// `boxRoot/src/views`. `listViews`/`compileView` resolve that directory from
// the box's shape (`getBoxShape`/`boxCodePaths`), reading a view's metadata by
// compiling it for the node target and importing the real module (in a
// timeout-bounded subprocess) rather than regexing source text.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, eventually, isoDate } from "@ianbicking/tap-check/check";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { listViews } from "../../../src/webapp/views/compiler/compile.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

const requireFromEngine = createRequire(join(PACKAGE_ROOT, "package.json"));

/**
 * Build a v3 (one-root, package-shaped) fixture box: a root with its own
 * `node_modules/beebox` and `node_modules/react` — symlinked to the
 * real engine copies, the same temp-symlink trick `bbx view check` uses
 * (src/cli/commands/view/command.ts), adapted here to simulate what a real
 * `pnpm install` of beebox would produce for a box's OWN node_modules.
 */
async function makeV3Box() {
  const root = await mkdtemp(join(tmpdir(), "bbx-v3box-"));
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "my-box", private: true, dependencies: { "beebox": "0.1.0" }, beebox: { shapeVersion: 3, created: "2026-01-01T00:00:00.000Z" } }),
  );
  await mkdir(join(root, "node_modules"), { recursive: true });
  await symlink(PACKAGE_ROOT, join(root, "node_modules", "beebox"), "dir");
  const reactNodeModules = dirname(dirname(requireFromEngine.resolve("react/package.json")));
  await symlink(join(reactNodeModules, "react"), join(root, "node_modules", "react"), "dir");
  await mkdir(join(root, "_config"), { recursive: true });
  await mkdir(join(root, "src", "views"), { recursive: true });
  return {
    root,
    contentRoot: root,
    async writeView(name: string, content: string) {
      await writeFile(join(root, "src", "views", name), content);
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

// Metadata computed at module scope (not a string literal `export const`) —
// a regex over source text can't see this; only a real import can.
const WIDGET_VIEW = `
import { CardLink } from "beebox/view-widgets";
const parts = ["Wid", "get", " View"];
export const name = parts.join("");
export const description = "renders a CardLink from beebox/view-widgets";
export const dependencies = [];
export const modes = ["page"];
export default function WidgetView() {
  return <div><CardLink cardRef="_content/inbox/Test.doc.card" /></div>;
}
`;

function runViewTest(contentRoot: string, slug: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [join(PACKAGE_ROOT, "dist/cli.mjs"), "view", "render-one", slug], {
      cwd: contentRoot,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += String(d); });
    child.stderr.on("data", (d: Buffer) => { stderr += String(d); });
    child.on("close", (code: number | null) => resolve({ code, stdout, stderr }));
  });
}

// ## listViews finds a view at `boxRoot/src/views`
void test("listViews finds a view at `boxRoot/src/views`", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeV3Box();
  await box.writeView("widget-view.tsx", WIDGET_VIEW);

  const views = await listViews(box.contentRoot);
  t.check(views, [{
    name: "Widget View",
    slug: "widget-view",
    description: "renders a CardLink from beebox/view-widgets",
    dependencies: [],
    modes: ["page"],
    layout: "inset",
    rendersCardTypes: [],
    lastModified: isoDate(),
  }]);

  // ## Its metadata comes from the real module exports, not regex
  //
  // `name` is computed (`parts.join("")`) — a fallback to the slug would mean the
  // import never happened:

  const meta = views[0];
  t.check(meta, {
    name: "Widget View",
    slug: "widget-view",
    description: "renders a CardLink from beebox/view-widgets",
    dependencies: [],
    modes: ["page"],
    layout: "inset",
    rendersCardTypes: [],
    lastModified: isoDate(),
  });

  // ## `bbx view check` renders it (via the hidden `view render-one`), resolving `beebox/view-widgets` and `react` through the box's own real `node_modules`

  const r = await runViewTest(box.contentRoot, "widget-view");
  t.check(r, {
    code: 0,
    stdout: "",
    stderr: "",
  });

});

// ## A broken view still appears in the listing, degraded to an error marker
void test("A broken view still appears in the listing, degraded to an error marker", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeV3Box();
  await box.writeView("broken.tsx", `
export const name = "Broken";
export default function Broken() {
  const x = ;
  return null;
}
`);

  const views = await listViews(box.contentRoot);
  t.check(views, [{
    name: "broken",
    slug: "broken",
    description: "Failed to compile",
    dependencies: [],
    modes: ["page"],
    layout: "inset",
    rendersCardTypes: [],
    lastModified: isoDate(),
  }]);
});

// ## A view whose module scope never resolves can't hang the lister
//
// A top-level infinite loop blocks module evaluation forever; the metadata
// import runs in a killable subprocess with a timeout, so `listViews` still
// returns promptly with the view marked broken rather than hanging:
void test("A top-level infinite loop blocks module evaluation forever; the metadata impo...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeV3Box();
  await box.writeView("hangs.tsx", `
export const name = "Hangs";
while (true) {}
export default function Hangs() { return null; }
`);

  const start = Date.now();
  const views = await listViews(box.contentRoot);
  const elapsedMs = Date.now() - start;
  t.check(views, [{
    name: "hangs",
    slug: "hangs",
    description: "Failed to compile",
    dependencies: [],
    modes: ["page"],
    layout: "inset",
    rendersCardTypes: [],
    lastModified: isoDate(),
  }]);
  t.check(elapsedMs, any(Number).below(10000));
});

// ## A spinning import does not outlive the lister
//
// The timeout above is the parent's. When the parent dies first (a test process
// that ends, a killed server), the child still stops: a worker thread in the
// runner kills its own process at a deadline, even while the import spins. Start a lister on the hanging view, wait for its
// metadata runner, kill the lister with SIGKILL, and the runner is gone within
// seconds:
// Each example gets 60s before a still-running notice.
void test("The timeout above is the parent's.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeV3Box();
  await box.writeView("spins.tsx", `
export const name = "Spins";
while (true) {}
export default function Spins() { return null; }
`);

  const lister = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", 'const { listViews } = await import("./src/webapp/views/compiler/compile.ts"); await listViews(process.env.BOX_ROOT);'],
    { cwd: PACKAGE_ROOT, env: { ...process.env, BOX_ROOT: box.contentRoot }, stdio: "ignore" },
  );

  function runnerOf(parentPid: number): number | null {
    const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" }).split("\n");
    for (const row of rows) {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);
      if (match !== null && Number(match[2]) === parentPid && match[3]?.includes("extract-meta-runner")) return Number(match[1]);
    }
    return null;
  }

  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (_e) {
      return false;
    }
  }

  const runner = await eventually(() => runnerOf(lister.pid ?? -1), { label: "the metadata runner starts", timeoutMs: 30000 });
  lister.kill("SIGKILL");
  t.check(await eventually(() => !alive(runner), { label: "the orphaned runner exits", timeoutMs: 15000 }), true);
});
