// # Static and project publication preparation
//
// `preparePublication` is a server-side, Cloudflare-free step. It reads the
// publication card, collects safe files from the card's attach folder, leak-scans the output, and returns a private temporary staging directory.
// The caller owns cleanup and passes only the card's box-relative path.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, anything, not } from "@ianbicking/tap-check/check";
import { mkdir, readFile, symlink, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { preparePublication, PUBLICATION_FILE_LIMITS, type PrepareDeps, type ProjectCommandRequest } from "../../src/publish/prepare/core/prepare-publication.js";
import { releaseIdForFiles } from "../../src/publish/manifest-edge.js";
import { createPublicationCardTemplate } from "../../src/schemas/publication.js";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";

const CARD = "_content/Example.publication.card";
const ATTACH = "_content/Example.attach";
const pubId = "abcdefghijklmnop2345672345";
type CardInput = Parameters<typeof createPublicationCardTemplate>[0];
const definition: CardInput = { pubId, connection: "personal", title: "Example site", tier: "secret" };

/** The card text; the source directory, not the card, picks static or project mode. */
function cardText(value?: Partial<CardInput>) {
  return createPublicationCardTemplate({ ...definition, ...value });
}

async function writeDefinition(box: TmpBox, value?: Partial<CardInput>) {
  await box.write(CARD, cardText(value));
}

type FixtureOptions = { mode?: string; files?: Record<string, string>; card?: string } & Partial<CardInput>;

/** Write a card and its source files under `<Name>.attach/static|project/`. */
async function writeFixture(box: TmpBox, options?: FixtureOptions) {
  const { mode = "static", files = {}, card = CARD, ...fields }: FixtureOptions = options ?? {};
  await box.write(card, cardText(fields));
  const attach = card.replace(/\.publication\.card$/, ".attach");
  for (const [file, text] of Object.entries(files)) await box.write(`${attach}/${mode}/${file}`, text);
}

async function prepareError(box: TmpBox, card?: string) {
  const result = await preparePublication({ boxRoot: box.root, card: card ?? CARD }, { ownerEmail: null });
  if (result.ok) {
    await result.prepared.cleanup();
    return "ok";
  }
  return `${result.reason}: ${result.message}`;
}

// ## Static mode copies only safe files and uses canonical release identity
void test("Static mode copies only safe files and uses canonical release identity", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/Example.attach/static/index.html", "<h1>Example</h1>");
  await box.write("_content/Example.attach/static/styles/main.css", "body { color: black; }");
  await box.write("_content/NOTES.md", "private shared notes");
  await box.write("_content/CLAUDE.md", "private authoring guidance");

  const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });
  t.check(result, { ok: true, prepared: anything() });

  assert.ok(result.ok);

  t.check(result.prepared.contentHash, await releaseIdForFiles(Object.fromEntries(result.prepared.files.map((file) => [file.path, { bytes: file.bytes, sha256: file.sha256 }]))));

  t.check(result.prepared.preview.map((file) => file.path), [
    "index.html",
    "styles/main.css",
  ]);

  t.check(result.prepared.files.map((file) => file.path), ["index.html", "styles/main.css"]);

  t.check((await readFile(path.join(result.prepared.stagedDir, "index.html"), "utf-8")), "<h1>Example</h1>");

  await result.prepared.cleanup();
  await box.cleanup();
});

// ## Same-publication builds are serialized before they touch `dist/`
//
// The per-name source lock protects install, build, collection, and local
// staging. It is released before the service takes its remote serving-state
// lock, so disablement does not wait for a package install.
void test("The per-name source lock protects install, build, collection, and local staging.", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/Example.attach/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
  await box.write("_content/Example.attach/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  let buildCount = 0;
  let firstBuildStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => { firstBuildStarted = resolve; });
  let finishFirstBuild: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => { finishFirstBuild = resolve; });
  const deps: PrepareDeps = {
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

  t.check(buildCount, 1);

  finishFirstBuild();
  const firstResult = await firstPrepare;
  const secondResult = await secondPrepare;
  t.check([firstResult, secondResult], [{ ok: true, prepared: anything() }, { ok: true, prepared: anything() }]);

  assert.ok(firstResult.ok && secondResult.ok);

  t.check(await readFile(path.join(firstResult.prepared.stagedDir, "index.html"), "utf-8"), "<p>build-1</p>");

  t.check(await readFile(path.join(secondResult.prepared.stagedDir, "index.html"), "utf-8"), "<p>build-2</p>");

  await firstResult.prepared.cleanup();
  await secondResult.prepared.cleanup();
  await box.cleanup();
});

// ## Static mode needs no package files or project runner
void test("Static mode needs no package files or project runner", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/Example.attach/static/index.html", "static only");
  let commandCount = 0;
  const result = await preparePublication({ boxRoot: box.root, card: CARD }, {
    ownerEmail: null,
    runProjectCommand: async () => { commandCount++; },
  });

  t.check(result, { ok: true, prepared: anything() });

  assert.ok(result.ok);

  t.check(commandCount, 0);

  await result.prepared.cleanup();
  await box.cleanup();
});

// ## Project mode clears stale output and runs only the standard commands
//
// The runner is injectable. Production calls only `pnpm install --frozen-lockfile`
// and `pnpm run build`, with a minimal environment that excludes server and agent
// credential variables.
void test("The runner is injectable.", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/Example.attach/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
  await box.write("_content/Example.attach/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  await box.write("_content/Example.attach/project/dist/stale-private.txt", "must disappear before build");
  const calls: ProjectCommandRequest[] = [];
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

  t.check(result, { ok: true, prepared: anything() });

  assert.ok(result.ok);

  t.check(calls.map((call) => call.step), [
    "install",
    "build",
  ]);

  t.check(Object.keys(calls[0]?.env ?? {}).toSorted(), [
    "HOME",
    "LANG",
    "PATH",
    "TEMP",
    "TMP",
    "TMPDIR",
  ]);

  t.check(result.prepared.preview.map((file) => file.path), [
    "index.html",
  ]);

  await result.prepared.cleanup();
  await box.cleanup();
});

// ## A failed build returns no staged release
void test("A failed build returns no staged release", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/Example.attach/project/package.json", JSON.stringify({ scripts: { build: "vite build" } }));
  await box.write("_content/Example.attach/project/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  await box.write("_publish/abcdefghijklmnop2345672345/manifest.json", "existing live pointer must not change");
  const result = await preparePublication({ boxRoot: box.root, card: CARD }, {
    ownerEmail: null,
    runProjectCommand: async ({ step }) => { if (step === "build") throw new Error("script failed CLOUDFLARE_API_TOKEN=credential-value"); },
  });

  // The message must carry the redaction marker and not the credential value.
  t.check(result, { ok: false, reason: "project-command-failed", step: "build", timedOut: false, message: "build failed: script failed CLOUDFLARE_API_TOKEN=[redacted]" });

  t.check(await box.read("_publish/abcdefghijklmnop2345672345/manifest.json"), "existing live pointer must not change");

  await box.cleanup();
});

// ## Internal release paths and public slug aliases are reserved
void test("Internal release paths and public slug aliases are reserved", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box, { tier: "public", slug: "example" });
  await box.write("_content/Example.attach/static/index.html", "<h1>Example</h1>");
  await box.write("_content/Example.attach/static/p/example/photo.jpg", "collision");
  const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

  t.check(result, { ok: false, reason: "bundle-policy", message: "output path 'p/example' collides with this publication's /p/example/ public alias" });

  await box.cleanup();
});

// ## Private notes, metadata, and uncompiled source cannot enter a release
void test("Private notes, metadata, and uncompiled source cannot enter a release", async (t) => {
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

  t.check(result, { ok: false, reason: "bundle-policy", message: "sensitive output filename 'CLAUDE.md' is not publishable" });

  await box.cleanup();
});

// A box's instruction file is `AGENTS.md` now, and it is just as private.
void test("A box's instruction file is AGENTS.md now, and it is just as private.", async (t) => {
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
        await writeFile(path.join(cwd, "dist/AGENTS.md"), "private notes");
      }
    },
  });

  t.check(result, { ok: false, reason: "bundle-policy", message: "sensitive output filename 'AGENTS.md' is not publishable" });

  await box.cleanup();
});

// ## A git-annex pointer is refused; text that only mentions the prefix is not
//
// An annexed file whose content was never fetched holds a short pointer line.
// Prepare refuses it by content, in static and project output alike.
void test("An annexed file whose content was never fetched holds a short pointer line.", async (t) => {
  const POINTER = `/annex/objects/SHA256E-s300000--${"a".repeat(64)}.jpg\n`;
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/Example.attach/static/index.html", "<h1>Home</h1>");
  await box.write("_content/Example.attach/static/photo.jpg", POINTER);
  const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

  t.check(result, { ok: false, reason: "bundle-policy", message: "file 'photo.jpg' is a git-annex pointer; its content is not in this checkout. Fetch it (git annex get) and prepare again" });

  await box.write("_content/Example.attach/static/photo.jpg", "Stored under /annex/objects/ when annexed.\n");
  await box.write("_content/Example.attach/static/big.txt", POINTER + "x".repeat(1100));
  const accepted = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

  t.check(accepted, { ok: true, prepared: anything() });

  assert.ok(accepted.ok);

  await box.cleanup();
});

// ## Static mode renders Markdown pages and does not ship the sources
//
// Each `.md` file becomes a sibling `.html` page styled by the box's Markdown
// renderer. The page title comes from frontmatter `title:`, then the first H1,
// then the file name. `index.md` satisfies the root-entry rule. Relative links to `.md`
// pages point at the rendered `.html`; external and anchor links are unchanged.
// Images and other files pass through. The release id, file list, and leak scan
// all describe the rendered pages, so a reviewer sees what is served.
void test("Each .md file becomes a sibling .html page styled by the box's Markdown rende...", async (t) => {
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
  t.check(result, { ok: true, prepared: anything() });

  assert.ok(result.ok);

  t.check(result.prepared.preview.map((file) => file.path), [
    "assets/map.svg",
    "days/one.html",
    "index.html",
    "packing.html",
  ]);

  t.check(result.prepared.contentHash, await releaseIdForFiles(Object.fromEntries(result.prepared.files.map((file) => [file.path, { bytes: file.bytes, sha256: file.sha256 }]))));

  const index = await readFile(path.join(result.prepared.stagedDir, "index.html"), "utf-8");
  // The rendered pages are generated HTML, so these checks keep the one fragment each names.
  t.check(index, any(String).includes("<title>Trip notes</title>"));
  t.check(index, any(String).includes('href="packing.html#tents"'));
  t.check(index, any(String).includes('href="days/one.html?print=1"'));
  t.check(index, any(String).includes('href="https://example.com/a.md"'));
  t.check(index, any(String).includes('src="assets/map.svg"'));
  t.check(index, not(any(String).includes("<script")));

  const packing = await readFile(path.join(result.prepared.stagedDir, "packing.html"), "utf-8");
  t.check(packing, any(String).includes("<title>Packing list</title>"));

  const dayOne = await readFile(path.join(result.prepared.stagedDir, "days/one.html"), "utf-8");
  t.check(dayOne, any(String).includes("<title>one</title>"));
  t.check(dayOne, any(String).includes('href="../index.html"'));

  t.check(result.prepared.scan.findings.filter((finding) => finding.match === "someone@example.org").map((finding) => finding.file), [
    "packing.html",
  ]);

  await result.prepared.cleanup();

  // Rendering is deterministic, so preparing an unchanged site again yields the same
  // release id.

  const again = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });
  assert.ok(again.ok);
  t.check(again.prepared.contentHash, result.prepared.contentHash);

  await again.prepared.cleanup();
  await box.cleanup();
});

// ## A Markdown page and an authored HTML page for the same path is an error
//
// `foo.md` next to `foo.html` is ambiguous, so prepare refuses it and the author
// keeps one. Invalid Markdoc tags also fail before anything is staged.
void test("foo.md next to foo.html is ambiguous, so prepare refuses it and the author ke...", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/Example.attach/static/index.md", "# Home\n");
  await box.write("_content/Example.attach/static/index.html", "<h1>Home</h1>");
  const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

  t.check(result, { ok: false, reason: "bundle-policy", message: "'index.md' renders to 'index.html', which also exists; keep only one of them" });

  await box.cleanup();
});

void test("A Markdown page and an authored HTML page for the same path is an error", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/Example.attach/static/index.md", "# Home\n\n{% no-such-tag %}\n");
  const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

  // The text after the colon is Markdoc's own message; the prefix and the file:line are ours.
  t.check(result, { ok: false, reason: "bundle-policy", message: any(String).startsWith("Markdown file 'index.md:3' has invalid Markdoc: ") });

  await box.cleanup();
});

// Box Markdoc tags render to app components, which a static page cannot show.
// A task-list item becomes a plain disabled checkbox labelled by its text.
// `redacted` content is omitted entirely, inline or block. Any other box tag
// fails prepare.
void test("Box Markdoc tags render to app components, which a static page cannot show.", async (t) => {
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
  t.check(index, any(String).includes('<label><input type="checkbox" disabled="" checked="">Tent</label>'));
  t.check(index, any(String).includes('<label><input type="checkbox" disabled="">Stove</label>'));
  t.check(index, not(any(String).includes("<Task")));

  t.check(index, any(String).includes("The answer is ."));

  t.check(index, not(any(String).matches(/forty-two|hidden paragraph|redacted/i)));

  if (result.ok) await result.prepared.cleanup();
  await box.write("_content/Example.attach/static/index.md", "# Quote\n\n{% quote %}Hello{% /quote %}\n");
  const quoted = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });
  t.check(quoted, { ok: false, reason: "bundle-policy", message: "Markdown file 'index.md' uses a box Markdoc tag (QuoteInline) that published pages do not support; remove it or write plain Markdown" });

  await box.cleanup();
});

// ## Project mode publishes `dist/` Markdown as written
//
// Rendering belongs to static mode. A project build owns its output.
void test("Rendering belongs to static mode.", async (t) => {
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

  assert.ok(result.ok);
  t.check(result.prepared.preview.map((file) => file.path), [
    "index.html",
    "readme.md",
  ]);

  if (result.ok) await result.prepared.cleanup();
  await box.cleanup();
});

// ## Unsafe output fails closed
//
// Hidden files, source maps, exact sensitive filenames, symlinks, and non-regular
// files are refused instead of silently omitted from the release.
void test("Hidden files, source maps, exact sensitive filenames, symlinks, and non-regul...", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/Example.attach/static/index.html", "<h1>Example</h1>");
  await box.write("_content/Example.attach/static/.env", "NOT A PUBLIC FILE");
  const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

  t.check(result, { ok: false, reason: "bundle-policy", message: "hidden output path '.env' is not publishable" });

  await box.cleanup();
});

// ## Per-file and file-count limits report observed and configured values
//
// The collector checks stat size before reading and refuses a file once its
// bounded read crosses the limit.
void test("The collector checks stat size before reading and refuses a file once its bou...", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  const oversizedPath = box.path("_content/Example.attach/static/large.bin");
  await mkdir(path.dirname(oversizedPath), { recursive: true });
  await writeFile(oversizedPath, Buffer.alloc(0));
  await truncate(oversizedPath, PUBLICATION_FILE_LIMITS.perFileBytes + 1);
  const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

  t.check(result, { ok: false, reason: "bundle-policy", message: "file 'large.bin' is 26214401 bytes; per-file limit is 26214400 bytes", observed: 26214401, limit: 26214400 });

  await box.cleanup();
});

// ## Total bytes and file count are bounded
//
// The total-byte guard stops before opening the first file that would cross the
// limit. The file-count guard stops before reading file 2,001.
void test("The total-byte guard stops before opening the first file that would cross the...", async (t) => {
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

  t.check(result, { ok: false, reason: "bundle-policy", message: "bundle would be 104857601 bytes; total limit is 104857600 bytes", observed: 104857601, limit: 104857600 });

  await box.cleanup();
});

void test("Total bytes and file count are bounded", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  const site = box.path("_content/Example.attach/static");
  await mkdir(site, { recursive: true });
  for (let i = 0; i <= PUBLICATION_FILE_LIMITS.files; i++) {
    await writeFile(path.join(site, `file-${String(i).padStart(4, "0")}.txt`), "");
  }
  const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

  t.check(result, { ok: false, reason: "bundle-policy", message: "bundle has more than 2000 files (observed at least 2001)", observed: 2001, limit: 2000 });

  await box.cleanup();
});

// ## Staged files are cleaned on preparation errors
//
// The error result carries no server-owned staging path, so a failed scan or
// project step cannot be uploaded accidentally.
void test("The error result carries no server-owned staging path, so a failed scan or pr...", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/Example.attach/static/index.html", "<h1>Example</h1>");
  await symlink("index.html", box.path("_content/Example.attach/static/index-copy.html"));
  const result = await preparePublication({ boxRoot: box.root, card: CARD }, { ownerEmail: null });

  t.check(result, { ok: false, reason: "bundle-policy", message: "symlink 'index-copy.html' is not publishable" });

  await box.cleanup();
});

// ## The card path decides what is prepared
//
// The card path is box-relative, ends in `.publication.card`, and stays inside
// the box. Anything else fails closed as `invalid-definition`.
void test("The card path is box-relative, ends in .publication.card, and stays inside th...", async (t) => {
  const box = await makeTmpBox();
  await writeFixture(box, { files: { "index.html": "<h1>Example</h1>" } });
  await box.write("_content/Example.note.md", "not a card");

  t.check(await prepareError(box, "_content/Example.note.md"), "invalid-definition: '_content/Example.note.md' is not a publication card; the path must end with .publication.card");

  t.check(await prepareError(box, "../x.publication.card"), "invalid-definition: publication card path '../x.publication.card' is not a file inside the box");

  await box.write("_tmp/Scratch.publication.card", "---\ntitle: Scratch\n---\n");
  t.check(await prepareError(box, "_tmp/Scratch.publication.card"), "invalid-definition: publication card '_tmp/Scratch.publication.card' must be under _content/");

  t.check(await prepareError(box, "_content/Missing.publication.card"), "invalid-definition: publication card _content/Missing.publication.card is not a regular file");

  await box.cleanup();
});

// ## Exactly one of `static/` or `project/` must exist
void test("Exactly one of `static/` or `project/` must exist", async (t) => {
  const box = await makeTmpBox();
  await writeFixture(box, { files: { "index.html": "both" } });
  await box.write(`${ATTACH}/project/package.json`, "{}");

  t.check(await prepareError(box), "invalid-source: publication card _content/Example.publication.card needs exactly one of _content/Example.attach/static/ or _content/Example.attach/project/; both exist");

  await box.cleanup();
});

void test("Exactly one of `static/` or `project/` must exist (line 700)", async (t) => {
  const box = await makeTmpBox();
  await writeFixture(box);
  await mkdir(box.path(`${ATTACH}/other`), { recursive: true });

  t.check(await prepareError(box), "invalid-source: publication card _content/Example.publication.card needs exactly one of _content/Example.attach/static/ or _content/Example.attach/project/; neither exists");

  await box.cleanup();
});

void test("Exactly one of `static/` or `project/` must exist (line 711)", async (t) => {
  const box = await makeTmpBox();
  await writeFixture(box);

  t.check(await prepareError(box), "invalid-source: publication card _content/Example.publication.card needs exactly one of _content/Example.attach/static/ or _content/Example.attach/project/; _content/Example.attach/ is not a directory");

  await box.cleanup();
});

// ## Symlinks are refused
void test("Symlinks are refused", async (t) => {
  const box = await makeTmpBox();
  await writeFixture(box, { card: "_content/Real.publication.card", files: { "index.html": "x" } });
  await symlink("Real.publication.card", box.path(CARD));

  t.check(await prepareError(box), "invalid-definition: _content/Example.publication.card must not be a symlink");

  await box.cleanup();
});

void test("Symlinks are refused (line 734)", async (t) => {
  const box = await makeTmpBox();
  await writeDefinition(box);
  await box.write("_content/elsewhere/index.html", "x");
  await mkdir(box.path(ATTACH), { recursive: true });
  await symlink("../elsewhere", box.path(`${ATTACH}/static`));

  t.check(await prepareError(box), "invalid-source: _content/Example.attach/static must not be a symlink");

  await box.cleanup();
});

// ## A publication id belongs to one card
void test("A publication id belongs to one card", async (t) => {
  const box = await makeTmpBox();
  await writeFixture(box, { files: { "index.html": "x" } });
  await writeFixture(box, { card: "_content/Other.publication.card", files: { "index.html": "y" } });

  t.check(await prepareError(box), "invalid-definition: publication id abcdefghijklmnop2345672345 is claimed by _content/Example.publication.card and _content/Other.publication.card; keep one card");

  await box.cleanup();
});

// ## An invalid card field names the card
void test("An invalid card field names the card", async (t) => {
  const box = await makeTmpBox();
  await writeFixture(box, { connection: "", files: { "index.html": "x" } });
  const badConnection = await prepareError(box);
  t.checkText(badConnection, `invalid-definition: publication card _content/Example.publication.card cannot be used: _content/Example.publication.card: invalid publication frontmatter:
  - connection: must start with a lowercase letter and contain only lowercase letters, digits, or hyphens (up to 40 characters)`);

  await box.cleanup();
});
