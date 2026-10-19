// # External-ref resolver + version markers
//
// `resolveExternalRef` turns a `file:` URL into a real, allowlisted path (the
// commentary surface's live wrapper, Track B). `buildVersionMarkers` produces the
// drift signal: a content hash (always) plus the last-modifying git commit (when
// tracked). Both are dev-only and read-only.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { instanceOf, not } from "@ianbicking/tap-check/check";
import {
  resolveExternalRef,
  buildVersionMarkers,
  ExternalRefError,
} from "../../../src/core/external/ref.js";
import { mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

// A tmp git repo with one committed file. realpath the root so it matches what
// resolveExternalRef returns (macOS tmpdir is a symlink to /private/...).
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "extref-")));
const file = path.join(root, "doc.md");
writeFileSync(file, "hello\n");

function git(...args: string[]): void {
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}
git("init", "-q");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
git("add", "doc.md");
git("commit", "-q", "-m", "add doc");

const roots = [root];
const href = `file:${file}`;

// An untracked file and a sibling outside the root, for the negative cases.
const untracked = path.join(root, "untracked.md");
writeFileSync(untracked, "x\n");
const outside = path.join(os.tmpdir(), `extref-outside-${process.pid}.md`);
writeFileSync(outside, "x\n");

function shape(markers: string): string {
  return markers
    .replace(/sha256:[\da-f]{12}/, "sha256:<hash>")
    .replace(/git:[\da-f]+/, "git:<rev>");
}
async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    return { resolved: await p };
  } catch (e) {
    return e;
  }
}

// ## Resolves a `file:` URL under an allowed root
void test("Resolves a `file:` URL under an allowed root", async (t) => {
  t.check(await resolveExternalRef(href, { roots }), file);
});

// ## Version markers: content hash + git rev for a committed file
void test("Version markers: content hash + git rev for a committed file", async (t) => {
  t.check(shape(await buildVersionMarkers(file)), "sha256:<hash> git:<rev>");
});

// ## An untracked file has only the content hash
void test("An untracked file has only the content hash", async (t) => {
  t.check(shape(await buildVersionMarkers(untracked)), "sha256:<hash>");
});

// ## A dirty edit changes the hash but keeps the git rev
void test("A dirty edit changes the hash but keeps the git rev", async (t) => {
  const before = await buildVersionMarkers(file);
  writeFileSync(file, "edited content\n");
  const after = await buildVersionMarkers(file);
  t.check(shape(before), "sha256:<hash> git:<rev>");
  t.check(shape(after), "sha256:<hash> git:<rev>");
  t.check(after, not(before));
});

// ## A non-`file:` URL is rejected
void test("A non-`file:` URL is rejected", async (t) => {
  t.check(await rejection(resolveExternalRef("https://example.com/x", { roots })), instanceOf(ExternalRefError));
});

// ## A path outside every allowed root is rejected
void test("A path outside every allowed root is rejected", async (t) => {
  t.check(await rejection(resolveExternalRef(`file:${outside}`, { roots })), instanceOf(ExternalRefError));
});

// ## A denylisted path (`.git/`) is rejected even under the root
void test("A denylisted path (`.git/`) is rejected even under the root", async (t) => {
  t.check(await rejection(resolveExternalRef(`file:${path.join(root, ".git", "config")}`, { roots })), instanceOf(ExternalRefError));
});
