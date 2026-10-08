# Static and project publication preparation

`preparePublication` is a server-side, Cloudflare-free step. It reads the
publication card, collects safe files from the card's attach folder, leak-scans the output, and returns a private temporary staging directory.
The caller owns cleanup and passes only the card's box-relative path.

```ts setup
import { mkdir, readFile, symlink, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { preparePublication, PUBLICATION_FILE_LIMITS } from "../../src/publish/prepare/core/prepare-publication.js";
import { releaseIdForFiles } from "../../src/publish/manifest-edge.js";
import { createPublicationCardTemplate } from "../../src/schemas/publication.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const CARD = "_content/Example.publication.card";
const ATTACH = "_content/Example.attach";
const pubId = "abcdefghijklmnop2345672345";
const definition = { pubId, connection: "personal", title: "Example site", tier: "secret" };

/** Write the card; the source directory, not the card, picks static or project mode. */
async function writeDefinition(box, value = {}, card = CARD) {
  await box.write(card, createPublicationCardTemplate({ ...definition, ...value }));
}

/** Write a card and its source files under `<Name>.attach/static|project/`. */
async function writeFixture(box, { mode = "static", files = {}, card = CARD, ...fields } = {}) {
  await writeDefinition(box, fields, card);
  const attach = card.replace(/\.publication\.card$/, ".attach");
  for (const [file, text] of Object.entries(files)) await box.write(`${attach}/${mode}/${file}`, text);
}

async function prepareError(box, card = CARD) {
  const result = await preparePublication({ boxRoot: box.root, card }, { ownerEmail: null });
  if (result.ok) {
    await result.prepared.cleanup();
    return "ok";
  }
  return `${result.reason}: ${result.message}`;
}
```

## Static mode copies only safe files and uses canonical release identity

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("_content/Example.attach/static/index.html", "<h1>Example</h1>");
await box.write("_content/Example.attach/static/styles/main.css", "body { color: black; }");
await box.write("_content/NOTES.md", "private shared notes");
await box.write("_content/CLAUDE.md", "private authoring guidance");

const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });
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
await writeDefinition(box);
await box.write("_content/Example.attach/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
await box.write("_content/Example.attach/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
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
const firstPrepare = preparePublication({ boxRoot: box.root, card: CARD }, deps);
await started;
const secondPrepare = preparePublication({ boxRoot: box.root, card: CARD }, deps);
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
await box.write("_content/Example.attach/static/index.html", "static only");
let commandCount = 0;
const result = await preparePublication({ boxRoot: box.root, card: CARD }, {
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
await writeDefinition(box);
await box.write("_content/Example.attach/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
await box.write("_content/Example.attach/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
await box.write("_content/Example.attach/project/dist/stale-private.txt", "must disappear before build");
const calls = [];
const parentEnv = { PATH: "/usr/bin:/bin", HOME: "/home/agent", LANG: "C.UTF-8", CLOUDFLARE_API_TOKEN: "not-in-child", OPENAI_API_KEY: "not-in-child" };
const result = await preparePublication({ boxRoot: box.root, card: CARD }, {
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
await writeDefinition(box);
await box.write("_content/Example.attach/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
await box.write("_content/Example.attach/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
await box.write("_publish/abcdefghijklmnop2345672345/manifest.json", "existing live pointer must not change");
const result = await preparePublication({ boxRoot: box.root, card: CARD }, {
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
await writeDefinition(box, { tier: "public", slug: "example" });
await box.write("_content/Example.attach/static/index.html", "<h1>Example</h1>");
await box.write("_content/Example.attach/static/p/example/photo.jpg", "collision");
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

result.ok
=> false

result.message.includes("public alias")
=> true

await box.cleanup();
```

## Private notes, metadata, and uncompiled source cannot enter a release

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("_content/Example.attach/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
await box.write("_content/Example.attach/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
const result = await preparePublication({ boxRoot: box.root, card: CARD }, {
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

## A git-annex pointer is refused; text that only mentions the prefix is not

An annexed file whose content was never fetched holds a short pointer line.
Prepare refuses it by content, in static and project output alike.

```ts
const POINTER = `/annex/objects/SHA256E-s300000--${"a".repeat(64)}.jpg\n`;
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("_content/Example.attach/static/index.html", "<h1>Home</h1>");
await box.write("_content/Example.attach/static/photo.jpg", POINTER);
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

result.ok ? "ok" : `${result.reason}: ${result.message}`
=> bundle-policy: file 'photo.jpg' is a git-annex pointer; its content is not in this checkout. Fetch it (git annex get) and prepare again

await box.write("_content/Example.attach/static/photo.jpg", "Stored under /annex/objects/ when annexed.\n");
await box.write("_content/Example.attach/static/big.txt", POINTER + "x".repeat(1100));
const accepted = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

accepted.ok
=> true

await box.cleanup();
```

## Static mode renders Markdown pages and does not ship the sources

Each `.md` file becomes a sibling `.html` page styled by the box's Markdown
renderer. The page title comes from frontmatter `title:`, then the first H1,
then the file name. `index.md` satisfies the root-entry rule. Relative links to `.md`
pages point at the rendered `.html`; external and anchor links are unchanged.
Images and other files pass through. The release id, file list, and leak scan
all describe the rendered pages, so a reviewer sees what is served.

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("_content/Example.attach/static/index.md", [
  "---",
  "title: Trip notes",
  "---",
  "# Welcome",
  "",
  "Read [the packing list](packing.md#tents), [day one](days/one.md?print=1), or [elsewhere](https://example.com/a.md).",
  "",
  "![map](assets/map.svg)",
  "",
].join("\n"));
await box.write("_content/Example.attach/static/packing.md", "# Packing list\n\nWrite to someone@example.org.\n");
await box.write("_content/Example.attach/static/days/one.md", "No heading here; back to [the index](../index.md).\n");
await box.write("_content/Example.attach/static/assets/map.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>");
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });
result.ok
=> true

JSON.stringify(result.prepared.preview.map((file) => file.path))
=> ["assets/map.svg","days/one.html","index.html","packing.html"]

result.prepared.contentHash === await releaseIdForFiles(Object.fromEntries(result.prepared.files.map((file) => [file.path, { bytes: file.bytes, sha256: file.sha256 }])))
=> true

const index = await readFile(path.join(result.prepared.stagedDir, "index.html"), "utf-8");
index.includes("<title>Trip notes</title>")
=> true

index.includes('href="packing.html#tents"') && index.includes('href="days/one.html?print=1"')
=> true

index.includes('href="https://example.com/a.md"') && index.includes('src="assets/map.svg"')
=> true

index.includes("<script")
=> false

const packing = await readFile(path.join(result.prepared.stagedDir, "packing.html"), "utf-8");
packing.includes("<title>Packing list</title>")
=> true

const dayOne = await readFile(path.join(result.prepared.stagedDir, "days/one.html"), "utf-8");
dayOne.includes("<title>one</title>") && dayOne.includes('href="../index.html"')
=> true

result.prepared.scan.findings.filter((finding) => finding.match === "someone@example.org").map((finding) => finding.file)
=> ["packing.html"]

await result.prepared.cleanup();
```

Rendering is deterministic, so preparing an unchanged site again yields the same
release id.

```ts continue
const again = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });
again.ok && again.prepared.contentHash === result.prepared.contentHash
=> true

await again.prepared.cleanup();
await box.cleanup();
```

## A Markdown page and an authored HTML page for the same path is an error

`foo.md` next to `foo.html` is ambiguous, so prepare refuses it and the author
keeps one. Invalid Markdoc tags also fail before anything is staged.

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("_content/Example.attach/static/index.md", "# Home\n");
await box.write("_content/Example.attach/static/index.html", "<h1>Home</h1>");
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

result.ok ? "ok" : `${result.reason}: ${result.message}`
=> bundle-policy: 'index.md' renders to 'index.html', which also exists; keep only one of them

await box.cleanup();
```

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("_content/Example.attach/static/index.md", "# Home\n\n{% no-such-tag %}\n");
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

result.ok ? "ok" : `${result.reason}: ${result.message.includes("'index.md:3' has invalid Markdoc")}`
=> bundle-policy: true

await box.cleanup();
```

Box Markdoc tags render to app components, which a static page cannot show.
A task-list item becomes a plain disabled checkbox. `redacted` content is
omitted entirely, inline or block. Any other box tag fails prepare.

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("_content/Example.attach/static/index.md", [
  "# Quiz",
  "",
  "- [x] Tent",
  "- [ ] Stove",
  "",
  "The answer is {% redacted %}forty-two{% /redacted %}.",
  "",
  "{% redacted %}",
  "A whole hidden paragraph.",
  "{% /redacted %}",
  "",
].join("\n"));
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });
const index = result.ok ? await readFile(path.join(result.prepared.stagedDir, "index.html"), "utf-8") : result.message;
index.includes('<input type="checkbox" disabled="" checked="">') && index.includes('<input type="checkbox" disabled="">') && !index.includes("<Task")
=> true

index.includes("The answer is .")
=> true

/forty-two|hidden paragraph|redacted/i.test(index)
=> false

if (result.ok) await result.prepared.cleanup();
await box.write("_content/Example.attach/static/index.md", "# Quote\n\n{% quote %}Hello{% /quote %}\n");
const quoted = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });
quoted.ok ? "ok" : `${quoted.reason}: ${quoted.message}`
=> bundle-policy: Markdown file 'index.md' uses a box Markdoc tag (QuoteInline) that published pages do not support; remove it or write plain Markdown

await box.cleanup();
```

## Project mode publishes `dist/` Markdown as written

Rendering belongs to static mode. A project build owns its output.

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("_content/Example.attach/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
await box.write("_content/Example.attach/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
const result = await preparePublication({ boxRoot: box.root, card: CARD }, {
  ownerEmail: null,
  runProjectCommand: async ({ step, cwd }) => {
    if (step !== "build") return;
    await mkdir(path.join(cwd, "dist"), { recursive: true });
    await writeFile(path.join(cwd, "dist/index.html"), "<h1>Built</h1>");
    await writeFile(path.join(cwd, "dist/readme.md"), "# Raw");
  },
});

JSON.stringify(result.ok && result.prepared.preview.map((file) => file.path))
=> ["index.html","readme.md"]

if (result.ok) await result.prepared.cleanup();
await box.cleanup();
```

## Unsafe output fails closed

Hidden files, source maps, exact sensitive filenames, symlinks, and non-regular
files are refused instead of silently omitted from the release.

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("_content/Example.attach/static/index.html", "<h1>Example</h1>");
await box.write("_content/Example.attach/static/.env", "NOT A PUBLIC FILE");
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

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
const oversizedPath = box.path("_content/Example.attach/static/large.bin");
await mkdir(path.dirname(oversizedPath), { recursive: true });
await writeFile(oversizedPath, Buffer.alloc(0));
await truncate(oversizedPath, PUBLICATION_FILE_LIMITS.perFileBytes + 1);
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

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
const site = box.path("_content/Example.attach/static");
await mkdir(site, { recursive: true });
for (let i = 0; i < 4; i++) {
  const file = path.join(site, `part-${i}.bin`);
  await writeFile(file, Buffer.alloc(0));
  await truncate(file, PUBLICATION_FILE_LIMITS.perFileBytes);
}
const oneMoreByte = path.join(site, "part-4.bin");
await writeFile(oneMoreByte, "x");
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

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
const site = box.path("_content/Example.attach/static");
await mkdir(site, { recursive: true });
for (let i = 0; i <= PUBLICATION_FILE_LIMITS.files; i++) {
  await writeFile(path.join(site, `file-${String(i).padStart(4, "0")}.txt`), "");
}
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

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
await box.write("_content/Example.attach/static/index.html", "<h1>Example</h1>");
await symlink("index.html", box.path("_content/Example.attach/static/index-copy.html"));
const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

result.ok
=> false

result.reason
=> bundle-policy

"prepared" in result
=> false

await box.cleanup();
```

## The card path decides what is prepared

The card path is box-relative, ends in `.publication.card`, and stays inside
the box. Anything else fails closed as `invalid-definition`.

```ts
const box = await makeTmpBox();
await writeFixture(box, { files: { "index.html": "<h1>Example</h1>" } });
await box.write("_content/Example.note.md", "not a card");

await prepareError(box, "_content/Example.note.md")
=> invalid-definition: '_content/Example.note.md' is not a publication card; the path must end with .publication.card

await prepareError(box, "../x.publication.card")
=> invalid-definition: publication card path '../x.publication.card' is not a file inside the box

await box.write("_tmp/Scratch.publication.card", "---\ntitle: Scratch\n---\n");
await prepareError(box, "_tmp/Scratch.publication.card")
=> invalid-definition: publication card '_tmp/Scratch.publication.card' must be under _content/

await prepareError(box, "_content/Missing.publication.card")
=> invalid-definition: publication card _content/Missing.publication.card is not a regular file

await box.cleanup();
```

## Exactly one of `static/` or `project/` must exist

```ts
const box = await makeTmpBox();
await writeFixture(box, { files: { "index.html": "both" } });
await box.write(`${ATTACH}/project/package.json`, "{}");

await prepareError(box)
=> invalid-source: publication card _content/Example.publication.card needs exactly one of _content/Example.attach/static/ or _content/Example.attach/project/; both exist

await box.cleanup();
```

```ts
const box = await makeTmpBox();
await writeFixture(box);
await mkdir(box.path(`${ATTACH}/other`), { recursive: true });

await prepareError(box)
=> invalid-source: publication card _content/Example.publication.card needs exactly one of _content/Example.attach/static/ or _content/Example.attach/project/; neither exists

await box.cleanup();
```

```ts
const box = await makeTmpBox();
await writeFixture(box);

await prepareError(box)
=> invalid-source: publication card _content/Example.publication.card needs exactly one of _content/Example.attach/static/ or _content/Example.attach/project/; _content/Example.attach/ is not a directory

await box.cleanup();
```

## Symlinks are refused

```ts
const box = await makeTmpBox();
await writeFixture(box, { card: "_content/Real.publication.card", files: { "index.html": "x" } });
await symlink("Real.publication.card", box.path(CARD));

await prepareError(box)
=> invalid-definition: _content/Example.publication.card must not be a symlink

await box.cleanup();
```

```ts
const box = await makeTmpBox();
await writeDefinition(box);
await box.write("_content/elsewhere/index.html", "x");
await mkdir(box.path(ATTACH), { recursive: true });
await symlink("../elsewhere", box.path(`${ATTACH}/static`));

await prepareError(box)
=> invalid-source: _content/Example.attach/static must not be a symlink

await box.cleanup();
```

## A publication id belongs to one card

```ts
const box = await makeTmpBox();
await writeFixture(box, { files: { "index.html": "x" } });
await writeFixture(box, { card: "_content/Other.publication.card", files: { "index.html": "y" } });

await prepareError(box)
=> invalid-definition: publication id abcdefghijklmnop2345672345 is claimed by _content/Example.publication.card and _content/Other.publication.card; keep one card

await box.cleanup();
```

## An invalid card field names the card

```ts
const box = await makeTmpBox();
await writeFixture(box, { connection: "", files: { "index.html": "x" } });
const badConnection = await prepareError(box);
badConnection.startsWith("invalid-definition: publication card _content/Example.publication.card cannot be used")
=> true

badConnection.includes("connection")
=> true

await box.cleanup();
```
