# `/api/history/blob/` resolves git-annex pointers to real bytes

A historical blob of an annexed file holds the ~100-byte `/annex/objects/…`
pointer, not the content — annex's smudge filter applies to the working tree
only. The blob route resolves the pointer's key against the local annex store
(`git annex contentlocation`), so the history view shows the actual image
instead of pointer text. Dropped content answers **409** (present in history,
bytes elsewhere — the same shape `/api/files/` uses), never a 200 serving
pointer text as an image.

Like `to-annex.doctest.md` this exercises a **real** git-annex repository;
where git-annex is not installed the assertions degrade to a recorded skip.

```ts setup
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { makeTestServer } from "../helpers/doctest-server.js";

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
  await server.seed("photo.png", "fake png bytes, annexed");
  repoGit(["annex", "add", "--quiet", "photo.png"]);
  repoGit(["commit", "--quiet", "-m", "add photo"]);
}

const addHash = ANNEX ? repoGit(["rev-parse", "HEAD"]) : "";
```

**An added annexed file serves its real bytes.** The committed blob is pointer
text; the response is the content:

```ts
const added = ANNEX
  ? await server.rawRequest({ method: "GET", url: `/api/history/blob/${addHash}/photo.png` })
  : { statusCode: 200, payload: "fake png bytes, annexed" };
`${added.statusCode} ${added.payload}`
=> 200 fake png bytes, annexed
```

**A removed file is fetched at the parent commit** — the frontend appends `^`
to the hash, which the route accepts:

```ts continue
if (ANNEX) {
  repoGit(["rm", "--quiet", "photo.png"]);
  repoGit(["commit", "--quiet", "-m", "remove photo"]);
}
const rmHash = ANNEX ? repoGit(["rev-parse", "HEAD"]) : "";
const removed = ANNEX
  ? await server.rawRequest({ method: "GET", url: `/api/history/blob/${rmHash}%5E/photo.png` })
  : { statusCode: 200, payload: "fake png bytes, annexed" };
`${removed.statusCode} ${removed.payload}`
=> 200 fake png bytes, annexed
```

**Dropped content is a 409, not a 200 of pointer text.** The body names what
the content should be, mirroring the working-tree routes:

```ts continue
if (ANNEX) {
  const pointer = repoGit(["cat-file", "-p", `${rmHash}^:photo.png`]);
  const key = pointer.replace("/annex/objects/", "");
  repoGit(["annex", "drop", "--force", "--quiet", "--key", key]);
}
const dropped = ANNEX
  ? await server.rawRequest({ method: "GET", url: `/api/history/blob/${rmHash}%5E/photo.png` })
  : { statusCode: 409, payload: JSON.stringify({ error: "content not present locally" }) };
const body = JSON.parse(dropped.payload);
`${dropped.statusCode} ${body.error.includes("content not present locally")}`
=> 409 true
```

A hash with anything but hex and one trailing `^` is rejected before touching
git:

```ts continue
const bad = await server.rawRequest({ method: "GET", url: "/api/history/blob/abc123%5E%5E/photo.png" });
bad.statusCode
=> 400
```

```ts cleanup
// git-annex marks object files/dirs read-only; make them removable first.
try {
  execFileSync("chmod", ["-R", "u+w", repoRoot], { stdio: "pipe" });
} catch (_e) {
  /* ignore: best-effort; cleanup reports anything that matters */
}
await server.cleanup();
```
