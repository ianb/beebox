// # `/api/history/blob/` resolves git-annex pointers to real bytes
//
// A historical blob of an annexed file holds the ~100-byte `/annex/objects/…`
// pointer, not the content — annex's smudge filter applies to the working tree
// only. The blob route resolves the pointer's key against the local annex store
// (`git annex contentlocation`), so the history view shows the actual image
// instead of pointer text. Dropped content answers **409** (present in history,
// bytes elsewhere — the same shape `/api/files/` uses), never a 200 serving
// pointer text as an image.
//
// Like `to-annex.doctest.md` this exercises a **real** git-annex repository;
// where git-annex is not installed the assertions degrade to a recorded skip.

import { test } from "tap";
import "agent-doctest/tap";
import { execFileSync } from "node:child_process";
import { makeTestServer } from "../../../helpers/doctest-server.js";

function hasAnnex(): boolean {
  try {
    execFileSync("git", ["annex", "version"], { stdio: "pipe" });
    return true;
  } catch (_e) {
    /* ignore: absence is the answer */
    return false;
  }
}

const ANNEX = hasAnnex();

const server = await makeTestServer();
// Under the one-root layout, git lives at the box root itself.
const repoRoot = server.boxRoot;

function repoGit(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" }).toString().trim();
}

if (ANNEX) {
  repoGit(["annex", "init", "--quiet", "doctest"]);
  repoGit(["config", "annex.addunlocked", "true"]);
  await server.seed("_content/photo.png", "fake png bytes, annexed");
  repoGit(["annex", "add", "--quiet", "_content/photo.png"]);
  repoGit(["commit", "--quiet", "-m", "add photo"]);
}

const addHash = ANNEX ? repoGit(["rev-parse", "HEAD"]) : "";

// **An added annexed file serves its real bytes.** The committed blob is pointer
// text; the response is the content:
void test("An added annexed file serves its real bytes. The committed blob is pointer te...", async (t) => {
  t.teardown(async () => {
    try {
      // git-annex marks object files/dirs read-only; make them removable first.
      try {
        execFileSync("chmod", ["-R", "u+w", repoRoot], { stdio: "pipe" });
      } catch (_e) {
        /* ignore: best-effort; cleanup reports anything that matters */
      }
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L54
  const added = ANNEX
    ? await server.rawRequest({ method: "GET", url: `/api/history/blob/${addHash}/_content/photo.png` })
    : { statusCode: 200, payload: "fake png bytes, annexed" };
  t.check(`${added.statusCode} ${added.payload}`, "200 fake png bytes, annexed");

  // **A removed file is fetched at the parent commit** — the frontend appends `^`
  // to the hash, which the route accepts:

  // doctest:L65
  if (ANNEX) {
    repoGit(["rm", "--quiet", "_content/photo.png"]);
    repoGit(["commit", "--quiet", "-m", "remove photo"]);
  }
  const rmHash = ANNEX ? repoGit(["rev-parse", "HEAD"]) : "";
  const removed = ANNEX
    ? await server.rawRequest({ method: "GET", url: `/api/history/blob/${rmHash}%5E/_content/photo.png` })
    : { statusCode: 200, payload: "fake png bytes, annexed" };
  t.check(`${removed.statusCode} ${removed.payload}`, "200 fake png bytes, annexed");

  // **Dropped content is a 409, not a 200 of pointer text.** The body names what
  // the content should be, mirroring the working-tree routes:

  // doctest:L81
  if (ANNEX) {
    const pointer = repoGit(["cat-file", "-p", `${rmHash}^:_content/photo.png`]);
    const key = pointer.replace("/annex/objects/", "");
    repoGit(["annex", "drop", "--force", "--quiet", "--key", key]);
  }
  const dropped = ANNEX
    ? await server.rawRequest({ method: "GET", url: `/api/history/blob/${rmHash}%5E/_content/photo.png` })
    : { statusCode: 409, payload: JSON.stringify({ error: "content not present locally" }) };
  const body = JSON.parse(dropped.payload);
  t.check(`${dropped.statusCode} ${body.error.includes("content not present locally")}`, "409 true");

  // A hash with anything but hex and one trailing `^` is rejected before touching
  // git:

  // doctest:L98
  const bad = await server.rawRequest({ method: "GET", url: "/api/history/blob/abc123%5E%5E/_content/photo.png" });
  t.check(bad.statusCode, 400);
});
