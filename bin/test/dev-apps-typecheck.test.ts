// # dev-apps-typecheck (bin/dev-apps-typecheck)
//
// Committed exhibit apps are unlinted by design, but they merge to main — so
// staged app source gets one this-will-build check: `tsc --noEmit` under the
// same compiler settings the exhibits container serves with. The script takes
// an alternate project directory so the gate is testable against fixtures.

import { test } from "tap";
import "agent-doctest/tap";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const script = join(repoRoot, "bin/dev-apps-typecheck");
// The fixture must live INSIDE the repo: tsc resolves react/vite types by
// walking up from the project directory to the hoisted root node_modules,
// exactly as dev/apps/ does. scratch/ is gitignored.
await mkdir(join(repoRoot, "scratch"), { recursive: true });
const root = await mkdtemp(join(repoRoot, "scratch/dev-apps-typecheck-"));

// A fixture project extending the REAL fragment, so this test fails if the
// fragment's settings (jsx runtime, strictness, @exhibits/client path) drift
// from what the script would enforce on dev/apps.
const project = join(root, "apps");
await mkdir(join(project, "demo"), { recursive: true });
await writeFile(join(project, "tsconfig.json"), JSON.stringify({
  extends: join(repoRoot, "workstreams-app/exhibits-page.tsconfig.json"),
  include: ["**/*.ts", "**/*.tsx"],
}));

// tap's NODE_OPTIONS loads its processinfo require hook into every child
// node. TypeScript 7's `bin/tsc` is an ES module, and that hook loading it
// through require() fails with ERR_REQUIRE_CYCLE_MODULE. tap puts the
// variable back on every spawn, so `env -u` drops it inside the child and the
// script runs as the pre-commit hook runs it.
function execError(e: unknown): { code?: number; stdout?: string; stderr?: string } {
  return typeof e === "object" && e !== null ? e : {};
}

async function run(dir: string) {
  try {
    const r = await execFileAsync("env", ["-u", "NODE_OPTIONS", "bash", script, dir]);
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    const err = execError(e);
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

// A page that compiles under the container's settings passes — including a
// typed `@exhibits/client` import, which proves the fragment's path mapping
// resolves. A type error fails with tsc naming the file. An app tree holding
// only `index.html` apps (no TypeScript at all) is a normal state, not a
// failure.
void test("A page that compiles under the container's settings passes — including a type...", async (t) => {
  // doctest:L56
  await writeFile(join(project, "demo/index.tsx"),
    'import { Storage } from "@exhibits/client";\n' +
    'export const storage = new Storage<{ level: number }>("state");\n');
  const good = await run(project);

  // doctest:L61
  await writeFile(join(project, "demo/index.tsx"), "const level: number = \"loud\";\nexport default level;\n");
  const bad = await run(project);

  // doctest:L64
  const htmlOnly = join(root, "html-only");
  await mkdir(htmlOnly, { recursive: true });
  await writeFile(join(htmlOnly, "tsconfig.json"), "{}");
  const empty = await run(htmlOnly);
  t.check(
    {
      good: good.code === 0,
      bad: bad.code !== 0 && bad.out.includes("demo/index.tsx"),
      empty: empty.code === 0 && empty.out.includes("nothing to check"),
    },
    {
    good: true,
    bad: true,
    empty: true,
  },
  );
});

// The real `dev/apps/` tree currently holds only `index.html`-tier apps, so a
// bare run reports nothing to check rather than erroring on an empty include.
void test("The real dev/apps/ tree currently holds only index.html-tier apps, so a bare...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L80
  const real = await run("");
  t.check({ code: real.code, quiet: real.out.includes("nothing to check") || real.out === "" }, {
    code: 0,
    quiet: true,
  });
});
