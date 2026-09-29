/**
 * The loader's handling of the mistakes agents make most often when writing
 * doctests (see beebox/docs/plans/doctest-usability.md): the ones that now
 * just work, and the ones reported as a failing TAP test naming the markdown
 * line, the block, and a fix.
 */

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "tap";

const FENCE = "```";

interface Run {
  status: number | null;
  stdout: string;
}

async function run(t: { teardown: (fn: () => unknown) => void }, markdown: string): Promise<Run> {
  const dir = await mkdtemp(join(process.cwd(), ".doctest-load-"));
  t.teardown(() => rm(dir, { recursive: true, force: true }));
  const fixture = join(dir, "fixture.doctest.md");
  await writeFile(fixture, markdown.replaceAll("~~~", FENCE));
  const tapCheck = fileURLToPath(new URL("../src/tap-check/tap.ts", import.meta.url));
  const loader = fileURLToPath(new URL("../src/doctest-loader.ts", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["--enable-source-maps", "--import=tsx", `--import=${tapCheck}`, `--import=${loader}`, fixture],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  return { status: result.status, stdout: result.stdout };
}

test("a missing blank line between examples is two examples", async (t) => {
  const r = await run(t, `~~~ts
"a,b".split(",").length
=> 2
"a,b".toUpperCase()
=> A,B
~~~
`);
  t.equal(r.status, 0, "fixture passes", r.status === 0 ? {} : { stdout: r.stdout });
});

test("=>value without a space, and an import in an example block, just work", async (t) => {
  const r = await run(t, `~~~ts
1 + 1
=>2

import { join } from "node:path";
join("a", "b")
=> a/b
~~~
`);
  t.equal(r.status, 0, "fixture passes", r.status === 0 ? {} : { stdout: r.stdout });
});

test("a try/catch before the checked expression is split by asking esbuild", async (t) => {
  const r = await run(t, `~~~ts
let err: unknown;
try {
  JSON.parse("{");
} catch (e) {
  err = e;
}
err instanceof SyntaxError
=> true
~~~
`);
  t.equal(r.status, 0, "fixture passes", r.status === 0 ? {} : { stdout: r.stdout });
});

test("a setup variable named t no longer collides with the runner", async (t) => {
  const r = await run(t, `~~~ts setup
const t = { request: (p: string) => "got " + p };
~~~

~~~ts
t.request("/x")
=> got /x
~~~
`);
  t.equal(r.status, 0, "fixture passes", r.status === 0 ? {} : { stdout: r.stdout });
});

test("json and bash fences are documentation, not code", async (t) => {
  const r = await run(t, `~~~json
{ "port": 3000 }
~~~

~~~bash
pnpm exec tap foo.doctest.md
~~~

~~~ts
1
=> 1
~~~
`);
  t.equal(r.status, 0, "fixture passes", r.status === 0 ? {} : { stdout: r.stdout });
});

test("prose in a fence fails as a TAP test naming the line, the block, and the fix", async (t) => {
  const r = await run(t, `# Title

~~~ts
const xs = [3, 1, 2];
xs.length
=> 3

Now we sort the list, which mutates it in place.
xs.sort()
=> [1, 2, 3]
~~~
`);
  t.not(r.status, 0);
  t.match(r.stdout, /not ok 1 - DoctestSyntaxError fixture\.doctest\.md:8: /);
  t.match(r.stdout, /8 \| Now we sort the list/);
  t.match(r.stdout, /4 \| const xs = \[3, 1, 2\];/, "shows the block's first line");
  t.match(r.stdout, /hint: this line looks like prose inside a code fence/);
  t.notMatch(r.stdout, /no tests found/);
});

test("an unknown directive and an indented fence are errors, not silent", async (t) => {
  const unknown = await run(t, "~~~ts setpu\nconst x = 1;\n~~~\n\n~~~ts\nx\n=> 1\n~~~\n");
  t.match(unknown.stdout, /"setpu" is not a doctest directive/);
  const indented = await run(t, "1. Step:\n\n   ~~~ts\n   1 + 1\n   => 3\n   ~~~\n");
  t.not(indented.status, 0);
  t.match(indented.stdout, /fixture\.doctest\.md:3: this fence is indented/);
});

test("a teardown block runs once, after every test in the file", async (t) => {
  const r = await run(t, `~~~ts setup
const log: string[] = [];
~~~

~~~ts
log.push("a");
log.length
=> 1
~~~

~~~ts
log.push("b");
log.length
=> 2
~~~

~~~ts teardown
console.log("TEARDOWN SAW " + log.join(","));
~~~
`);
  t.equal(r.status, 0, "fixture passes", r.status === 0 ? {} : { stdout: r.stdout });
  t.match(r.stdout, /TEARDOWN SAW a,b/);
});

test("a runtime error's stack names the markdown line", async (t) => {
  const r = await run(t, `~~~ts setup
function boom(x: number) { if (x > 1) throw new Error("too big: " + x); return x; }
~~~

~~~ts
boom(1)
=> 1

boom(2)
=> 2
~~~
`);
  t.not(r.status, 0);
  t.match(r.stdout, /fixture\.doctest\.md:2:\d+/, "the throw is placed in the setup line");
  t.match(r.stdout, /fixture\.doctest\.md:9:\d+/, "the call is placed on the example line");
});

test("a setup block that throws is reported by name and first lines", async (t) => {
  const r = await run(t, `~~~ts setup
const config = { port: 1 };
throw new Error("fixture server did not start");
~~~

~~~ts
config.port
=> 1
~~~
`);
  t.not(r.status, 0);
  t.match(r.stdout, /not ok 1 - setup block at fixture\.doctest\.md:1 threw Error: fixture server did not start/);
  t.match(r.stdout, /2 \| const config = \{ port: 1 \};/);
  t.notMatch(r.stdout, /no tests found/);
});

test("eventually() retries until true and names what never became true", async (t) => {
  const r = await run(t, `~~~ts
let n = 0;
await eventually(() => ++n >= 3)
=> true

await eventually(() => false, { label: "the file appears", timeoutMs: 50 })
=> throws EventuallyTimeout: the file appears was not true after 50ms; last value: false
~~~
`);
  t.equal(r.status, 0, "fixture passes", r.status === 0 ? {} : { stdout: r.stdout });
});

test("an example still running after its timeout is named in a TAP comment", async (t) => {
  const r = await run(t, `~~~ts timeout=100ms
await new Promise((resolve) => setTimeout(resolve, 300));
"done"
=> done
~~~
`);
  t.equal(r.status, 0, "fixture passes", r.status === 0 ? {} : { stdout: r.stdout });
  t.match(r.stdout, /# still running after 0\.1s: fixture\.doctest\.md:2 await new Promise/);
});
