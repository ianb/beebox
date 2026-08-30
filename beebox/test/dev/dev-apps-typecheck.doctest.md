# dev-apps-typecheck (bin/dev-apps-typecheck)

Committed exhibit apps are unlinted by design, but they merge to main — so
staged app source gets one this-will-build check: `tsc --noEmit` under the
same compiler settings the exhibits container serves with. The script takes
an alternate project directory so the gate is testable against fixtures.

```ts setup
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

async function run(dir: string) {
  try {
    const r = await execFileAsync("bash", [script, dir]);
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}
```

A page that compiles under the container's settings passes — including a
typed `@exhibits/client` import, which proves the fragment's path mapping
resolves. A type error fails with tsc naming the file. An app tree holding
only `index.html` apps (no TypeScript at all) is a normal state, not a
failure.

```ts
await writeFile(join(project, "demo/index.tsx"),
  'import { Storage } from "@exhibits/client";\n' +
  'export const storage = new Storage<{ level: number }>("state");\n');
const good = await run(project);

await writeFile(join(project, "demo/index.tsx"), "const level: number = \"loud\";\nexport default level;\n");
const bad = await run(project);

const htmlOnly = join(root, "html-only");
await mkdir(htmlOnly, { recursive: true });
await writeFile(join(htmlOnly, "tsconfig.json"), "{}");
const empty = await run(htmlOnly);
JSON.stringify({
  good: good.code === 0,
  bad: bad.code !== 0 && bad.out.includes("demo/index.tsx"),
  empty: empty.code === 0 && empty.out.includes("nothing to check"),
})
=> {"good":true,"bad":true,"empty":true}
```

The real `dev/apps/` tree currently holds only `index.html`-tier apps, so a
bare run reports nothing to check rather than erroring on an empty include.

```ts
const real = await run("");
JSON.stringify({ code: real.code, quiet: real.out.includes("nothing to check") || real.out === "" })
=> {"code":0,"quiet":true}
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
