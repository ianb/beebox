# Static and project publication preparation

`preparePublication` is a server-side, Cloudflare-free step. It reads the
registered box's strict definition, collects safe files from a fixed source
root, leak-scans the output, and returns a private temporary staging directory.
The caller owns cleanup and passes only the publication name over the RPC.

```ts setup
import { mkdir, readFile, symlink, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { preparePublication, PUBLICATION_FILE_LIMITS } from "../../src/publish/prepare.js";
import { releaseIdForFiles } from "../../src/publish/manifest-edge.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const definition = {
  pubId: "abcdefghijklmnop2345672345",
  connection: "personal",
  content: "static",
  title: "Example site",
  tier: "secret",
};

async function writeDefinition(box, value = definition, name = "example") {
  await box.write(`src/publications/${name}/publication.json`, JSON.stringify(value));
}
```

## Static mode copies only safe files and uses canonical release identity

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("src/publications/example/site/index.html", "<h1>Example</h1>");
await box.write("src/publications/example/site/styles/main.css", "body { color: black; }");
await box.write("src/publications/NOTES.md", "private shared notes");
await box.write("src/publications/CLAUDE.md", "private authoring guidance");

const result = await preparePublication({ boxRoot: box.root, name: "example" }, { ownerEmail: null });
result.ok
=> true

result.prepared.contentHash === await releaseIdForFiles(Object.fromEntries(result.prepared.files.map((file) => [file.path, { bytes: file.bytes, sha256: file.sha256 }])))
=> true

JSON.stringify(result.prepared.preview.map((file) => file.path))
=> ["index.html","styles/main.css"]

result.prepared.files.some((file) => file.path.includes("NOTES.md") || file.path.includes("CLAUDE.md"))
=> false

(await readFile(path.join(result.prepared.stagedDir, "index.html"), "utf-8"))
=> <h1>Example</h1>

await result.prepared.cleanup();
await box.cleanup();
```

## Same-publication builds are serialized before they touch `dist/`

The per-name source lock protects install, build, collection, and local
staging. It is released before the service takes its remote serving-state
lock, so disablement does not wait for a package install.

```ts
const box = await makeTmpBox();
await writeDefinition(box, { ...definition, content: "project" });
await box.write("src/publications/example/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
await box.write("src/publications/example/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
let buildCount = 0;
let firstBuildStarted: () => void = () => {};
const started = new Promise((resolve) => { firstBuildStarted = resolve; });
let finishFirstBuild: () => void = () => {};
const firstGate = new Promise((resolve) => { finishFirstBuild = resolve; });
const deps = {
  ownerEmail: null,
  runProjectCommand: async ({ step, cwd }) => {
    if (step !== "build") return;
    const current = ++buildCount;
    if (current === 1) {
      firstBuildStarted();
      await firstGate;
    }
    await mkdir(path.join(cwd, "dist"), { recursive: true });
    await writeFile(path.join(cwd, "dist/index.html"), `<p>build-${current}</p>`);
  },
};
const firstPrepare = preparePublication({ boxRoot: box.root, name: "example" }, deps);
await started;
const secondPrepare = preparePublication({ boxRoot: box.root, name: "example" }, deps);
await new Promise((resolve) => setTimeout(resolve, 30));

buildCount
=> 1

finishFirstBuild();
const firstResult = await firstPrepare;
const secondResult = await secondPrepare;
firstResult.ok && secondResult.ok
=> true

await readFile(path.join(firstResult.prepared.stagedDir, "index.html"), "utf-8")
=> <p>build-1</p>

await readFile(path.join(secondResult.prepared.stagedDir, "index.html"), "utf-8")
=> <p>build-2</p>

await firstResult.prepared.cleanup();
await secondResult.prepared.cleanup();
await box.cleanup();
```

## Static mode needs no package files or project runner

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("src/publications/example/site/index.html", "static only");
let commandCount = 0;
const result = await preparePublication({ boxRoot: box.root, name: "example" }, {
  ownerEmail: null,
  runProjectCommand: async () => { commandCount++; },
});

result.ok
=> true

commandCount
=> 0

await result.prepared.cleanup();
await box.cleanup();
```

## Project mode clears stale output and runs only the standard commands

The runner is injectable. Production calls only `pnpm install --frozen-lockfile`
and `pnpm run build`, with a minimal environment that excludes server and agent
credential variables.

```ts
const box = await makeTmpBox();
await writeDefinition(box, { ...definition, content: "project" });
await box.write("src/publications/example/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
await box.write("src/publications/example/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
await box.write("src/publications/example/project/dist/stale-private.txt", "must disappear before build");
const calls = [];
const parentEnv = { PATH: "/usr/bin:/bin", HOME: "/home/agent", LANG: "C.UTF-8", CLOUDFLARE_API_TOKEN: "not-in-child", OPENAI_API_KEY: "not-in-child" };
const result = await preparePublication({ boxRoot: box.root, name: "example" }, {
  ownerEmail: null,
  parentEnv,
  runProjectCommand: async (request) => {
    calls.push(request);
    if (request.step === "build") {
      await mkdir(path.join(request.cwd, "dist"), { recursive: true });
      await writeFile(path.join(request.cwd, "dist/index.html"), "<h1>Built site</h1>");
    }
  },
});

result.ok
=> true

JSON.stringify(calls.map((call) => call.step))
=> ["install","build"]

JSON.stringify(Object.keys(calls[0].env).sort())
=> ["HOME","LANG","PATH","TEMP","TMP","TMPDIR"]

calls[0].env.CLOUDFLARE_API_TOKEN
=> undefined

JSON.stringify(result.prepared.preview.map((file) => file.path))
=> ["index.html"]

await result.prepared.cleanup();
await box.cleanup();
```

## A failed build returns no staged release

```ts
const box = await makeTmpBox();
await writeDefinition(box, { ...definition, content: "project" });
await box.write("src/publications/example/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
await box.write("src/publications/example/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
await box.write("_publish/abcdefghijklmnop2345672345/manifest.json", "existing live pointer must not change");
const result = await preparePublication({ boxRoot: box.root, name: "example" }, {
  ownerEmail: null,
  runProjectCommand: async ({ step }) => { if (step === "build") throw new Error("script failed CLOUDFLARE_API_TOKEN=credential-value"); },
});

result.ok
=> false

result.reason
=> project-command-failed

result.step
=> build

result.message.includes("credential-value")
=> false

result.message.includes("CLOUDFLARE_API_TOKEN=[redacted]")
=> true

await box.read("_publish/abcdefghijklmnop2345672345/manifest.json")
=> existing live pointer must not change

await box.cleanup();
```

## Internal release paths and public slug aliases are reserved

```ts
const box = await makeTmpBox();
await writeDefinition(box, { ...definition, tier: "public", slug: "example" });
await box.write("src/publications/example/site/index.html", "<h1>Example</h1>");
await box.write("src/publications/example/site/p/example/photo.jpg", "collision");
const result = await preparePublication({ boxRoot: box.root, name: "example" }, { ownerEmail: null });

result.ok
=> false

result.message.includes("public alias")
=> true

await box.cleanup();
```

## Private notes, metadata, and uncompiled source cannot enter a release

```ts
const box = await makeTmpBox();
await writeDefinition(box, { ...definition, content: "project" });
await box.write("src/publications/example/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
await box.write("src/publications/example/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
const result = await preparePublication({ boxRoot: box.root, name: "example" }, {
  ownerEmail: null,
  runProjectCommand: async ({ step, cwd }) => {
    if (step === "build") {
      await mkdir(path.join(cwd, "dist"), { recursive: true });
      await writeFile(path.join(cwd, "dist/index.html"), "<h1>Built</h1>");
      await writeFile(path.join(cwd, "dist/CLAUDE.md"), "private notes");
    }
  },
});

result.ok
=> false

result.message.includes("CLAUDE.md")
=> true

await box.cleanup();
```

## Unsafe output fails closed

Hidden files, source maps, exact sensitive filenames, symlinks, and non-regular
files are refused instead of silently omitted from the release.

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("src/publications/example/site/index.html", "<h1>Example</h1>");
await box.write("src/publications/example/site/.env", "NOT A PUBLIC FILE");
const result = await preparePublication({ boxRoot: box.root, name: "example" }, { ownerEmail: null });

result.ok
=> false

result.reason
=> bundle-policy

result.message.includes("hidden output path")
=> true

await box.cleanup();
```

## Per-file and file-count limits report observed and configured values

The collector checks stat size before reading and refuses a file once its
bounded read crosses the limit.

```ts
const box = await makeTmpBox();
await writeDefinition(box);
const oversizedPath = box.path("src/publications/example/site/large.bin");
await mkdir(path.dirname(oversizedPath), { recursive: true });
await writeFile(oversizedPath, Buffer.alloc(0));
await truncate(oversizedPath, PUBLICATION_FILE_LIMITS.perFileBytes + 1);
const result = await preparePublication({ boxRoot: box.root, name: "example" }, { ownerEmail: null });

result.ok
=> false

result.reason
=> bundle-policy

result.observed
=> 26214401

result.limit
=> 26214400

await box.cleanup();
```

## Total bytes and file count are bounded

The total-byte guard stops before opening the first file that would cross the
limit. The file-count guard stops before reading file 2,001.

```ts
const box = await makeTmpBox();
await writeDefinition(box);
const site = box.path("src/publications/example/site");
await mkdir(site, { recursive: true });
for (let i = 0; i < 4; i++) {
  const file = path.join(site, `part-${i}.bin`);
  await writeFile(file, Buffer.alloc(0));
  await truncate(file, PUBLICATION_FILE_LIMITS.perFileBytes);
}
const oneMoreByte = path.join(site, "part-4.bin");
await writeFile(oneMoreByte, "x");
const result = await preparePublication({ boxRoot: box.root, name: "example" }, { ownerEmail: null });

result.ok
=> false

result.observed
=> 104857601

result.limit
=> 104857600

await box.cleanup();
```

```ts
const box = await makeTmpBox();
await writeDefinition(box);
const site = box.path("src/publications/example/site");
await mkdir(site, { recursive: true });
for (let i = 0; i <= PUBLICATION_FILE_LIMITS.files; i++) {
  await writeFile(path.join(site, `file-${String(i).padStart(4, "0")}.txt`), "");
}
const result = await preparePublication({ boxRoot: box.root, name: "example" }, { ownerEmail: null });

result.ok
=> false

result.observed
=> 2001

result.limit
=> 2000

await box.cleanup();
```

## Staged files are cleaned on preparation errors

The error result carries no server-owned staging path, so a failed scan or
project step cannot be uploaded accidentally.

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("src/publications/example/site/index.html", "<h1>Example</h1>");
await symlink("index.html", box.path("src/publications/example/site/index-copy.html"));
const result = await preparePublication({ boxRoot: box.root, name: "example" }, { ownerEmail: null });

result.ok
=> false

result.reason
=> bundle-policy

"prepared" in result
=> false

await box.cleanup();
```
