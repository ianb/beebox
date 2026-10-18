// # `todos.setStatus` — tick one todo from the web UI
//
// The checkbox on a rendered todo calls `todos.setStatus`
// (`docs/plans/todos-ui.md`, Track 3). It addresses the todo by card path and
// locator, and also sends the text and status the reader saw. Under the card
// lock the server re-extracts the card and writes only if the todo at that
// locator still reads the same and still has that status; otherwise it refuses
// with `CONFLICT` and writes nothing. The write changes only the `status`
// attribute, commits with webapp trailers, and announces a `file-change`.

import { test } from "tap";
import "agent-doctest/tap";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

const events: string[] = [];

function caller(boxRoot: string, options?: { authed?: boolean; isOwner?: boolean }) {
  const ctx: TrpcContext = trpcContext({
    boxRoot,
    eventBus: {
      emit: () => 0,
      emitTransient: (name, data) => { events.push(`${name} ${"path" in data ? data.path : undefined}`); },
      readSince: () => [],
      readRecent: () => [],
      subscribe: () => ({ unsubscribe: () => {} }),
      prune: () => 0,
      close: () => {},
    },
    authed: options?.authed !== false,
    isOwner: options?.isOwner !== false,
    isAuthenticatedOwner: options?.isOwner !== false,
  });
  return appRouter.createCaller(ctx);
}

function lastCommit(root: string) {
  return execFileSync("git", ["log", "-1", "--format=%s%n%(trailers:only,unfold)"], { cwd: root, encoding: "utf8" }).trim();
}

function commitCount(root: string) {
  return execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

/** The error code a refused call rejects with, or "accepted". */
function outcome(promise: Promise<unknown>): Promise<string> {
  return promise.then(() => "accepted", (error: unknown) => (error instanceof TRPCError ? `${error.code}: ${error.message}` : String(error)));
}

const cardPath = "_content/Porch.doc.card";
const original = [
  "---",
  "title: Porch",
  "via:",
  "  channel: email",
  "todos:",
  "  - text: Call the inspector",
  "    due: 2026-10-01",
  "---",
  "Intro line.",
  "",
  "{% todo due=\"2026-09-15\" %}Order lumber{% /todo %} and {% todo %}book the [roofer](https://example.com){% /todo %}",
  "",
  "{% todo status=\"parked\" %}Paint the rail{% /todo %}",
  "",
].join("\n");

const box = await makeTmpBox({ git: true });
await box.write(cardPath, original);
box.commitAll("seed");

// ## Tick, then untick
//
// Ticking the first todo on line 11 sets `status="done"` on exactly that tag,
// keeps its other attributes, and commits. Nothing else in the file moves.
void test("Ticking the first todo on line 11 sets status=\"done\" on exactly that tag, kee...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L84
  events.length = 0;
  const done = await caller(box.root).todos.setStatus({
    path: cardPath,
    locator: { kind: "body", line: 11 },
    text: "Order lumber",
    expectedStatus: "open",
    status: "done",
  });
  t.check([done.status, typeof done.commit, done.commitWarning], [
    "done",
    "string",
    null,
  ]);

  // doctest:L95
  await t.checkText((await box.read(cardPath)).split("\n")[10], "{% todo status=\"done\" due=\"2026-09-15\" %}Order lumber{% /todo %} and {% todo %}book the [roofer](https://example.com){% /todo %}");

  // doctest:L98
  await t.checkText(lastCommit(box.root), `Mark todo done: Order lumber
Source: webapp
Endpoint: todos.setStatus`);

  // doctest:L103
  t.check(events, [
    "file-change _content/Porch.doc.card",
  ]);

  // Reopening removes the attribute (absence means open), and the file is back
  // to what it was.

  // doctest:L111
  const reopened = await caller(box.root).todos.setStatus({
    path: cardPath,
    locator: { kind: "body", line: 11 },
    text: "Order lumber",
    expectedStatus: "done",
    status: "open",
  });
  t.check([reopened.status, (await box.read(cardPath)) === original, lastCommit(box.root).split("\n")[0]], [
    "open",
    true,
    "Reopen todo: Order lumber",
  ]);

  // ## The second todo on a line
  //
  // The locator's `nth` picks the second tag on line 11. Its text is what the
  // collector flattens: the link's label, not its target.

  // doctest:L128
  await caller(box.root).todos.setStatus({
    path: cardPath,
    locator: { kind: "body", line: 11, nth: 2 },
    text: "book the roofer",
    expectedStatus: "open",
    status: "done",
  });
  await t.checkText((await box.read(cardPath)).split("\n")[10], "{% todo due=\"2026-09-15\" %}Order lumber{% /todo %} and {% todo status=\"done\" %}book the [roofer](https://example.com){% /todo %}");

  // ## A frontmatter todo
  //
  // Frontmatter todos go through format-preserving YAML: only the entry's
  // `status` changes.

  // doctest:L145
  await caller(box.root).todos.setStatus({
    path: cardPath,
    locator: { kind: "frontmatter", index: 0 },
    text: "Call the inspector",
    expectedStatus: "open",
    status: "done",
  });
  await t.checkText((await box.read(cardPath)).split("\n").slice(4, 8).join("\n"), `todos:
  - text: Call the inspector
    due: 2026-10-01
    status: done`);

  // That added a line to the frontmatter, so every body todo is now one line
  // further down: "Order lumber" is at line 12. A reader still looking at the
  // old render would send line 11, which the checks below refuse.
  //
  // ## Refusals write nothing
  //
  // Each refusal below leaves the file and the history as they were.

  // doctest:L168
  const before = await box.read(cardPath);
  const commitsBefore = commitCount(box.root);
  events.length = 0;

  // The text the reader saw is not the text at that line (a line was inserted
  // above it, or it was reworded):

  // doctest:L177
  t.check(
    await outcome(caller(box.root).todos.setStatus({
      path: cardPath, locator: { kind: "body", line: 12 }, text: "Order timber", expectedStatus: "open", status: "done",
    })),
    "CONFLICT: This card changed since it was shown — it has been reloaded",
  );

  // The text matches, but its status is no longer the one the reader saw:

  // doctest:L186
  t.check(
    await outcome(caller(box.root).todos.setStatus({
      path: cardPath, locator: { kind: "body", line: 12, nth: 2 }, text: "book the roofer", expectedStatus: "open", status: "done",
    })),
    "CONFLICT: This card changed since it was shown — it has been reloaded",
  );

  // A parked todo is always refused: the checkbox cannot express `parked`.

  // doctest:L195
  t.check(
    await outcome(caller(box.root).todos.setStatus({
      path: cardPath, locator: { kind: "body", line: 14 }, text: "Paint the rail", expectedStatus: "open", status: "done",
    })),
    "CONFLICT: This card changed since it was shown — it has been reloaded",
  );

  // No todo at that address any more — the stale line from before the
  // frontmatter grew:

  // doctest:L205
  t.check(
    await outcome(caller(box.root).todos.setStatus({
      path: cardPath, locator: { kind: "body", line: 11 }, text: "Order lumber", expectedStatus: "open", status: "done",
    })),
    "CONFLICT: This card changed since it was shown — it has been reloaded",
  );

  // A card whose frontmatter no longer parses has no todos to address:

  // doctest:L214
  const brokenPath = "_content/Broken.doc.card";
  await box.write(brokenPath, "---\ntitle: [not, a, title]\ntodos:\n  - text: Fix it\n---\n{% todo %}Fix it{% /todo %}\n");
  box.commitAll("broken");
  const brokenBefore = await box.read(brokenPath);
  t.check(
    await outcome(caller(box.root).todos.setStatus({
      path: brokenPath, locator: { kind: "body", line: 6 }, text: "Fix it", expectedStatus: "open", status: "done",
    })),
    "CONFLICT: This card changed since it was shown — it has been reloaded",
  );

  // doctest:L223
  await t.checkText((await box.read(brokenPath)) === brokenBefore, "true");

  // Anyone the box admits may tick a todo, not only the owner, just as they may
  // edit the card. A non-owner's call gets past access control to the ordinary
  // stale check (here it names text that is not there, so nothing is written); an
  // unauthenticated caller is refused:

  // doctest:L233
  t.check(
    await outcome(caller(box.root, { isOwner: false }).todos.setStatus({
      path: cardPath, locator: { kind: "body", line: 12 }, text: "no such todo text", expectedStatus: "open", status: "done",
    })),
    "CONFLICT: This card changed since it was shown — it has been reloaded",
  );

  // doctest:L238
  t.check(
    await outcome(caller(box.root, { authed: false, isOwner: false }).todos.setStatus({
      path: cardPath, locator: { kind: "body", line: 12 }, text: "Order lumber", expectedStatus: "open", status: "done",
    })),
    "UNAUTHORIZED: Not authenticated",
  );

  // A path outside the box is refused before anything is read:

  // doctest:L247
  t.check(
    (await outcome(caller(box.root).todos.setStatus({
      path: "_content/../package.json", locator: { kind: "body", line: 1 }, text: "x", expectedStatus: "open", status: "done",
    }))).split(":")[0],
    "BAD_REQUEST",
  );

  // After all of that, nothing changed and nothing was announced (the broken
  // card's seed commit is the only new one):

  // doctest:L257
  t.check([(await box.read(cardPath)) === before, Number(commitCount(box.root)) - Number(commitsBefore), events], [
    true,
    1,
    [],
  ]);

  // ## A failed commit is a warning, not a lost write
  //
  // The file is written first; if the commit then fails, the write stands and
  // the result says the commit did not happen.

  // doctest:L267
  const hook = path.join(box.root, ".git", "hooks", "pre-commit");
  await fs.writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const originalError = console.error;
  console.error = () => {};
  const warned = await caller(box.root).todos.setStatus({
    path: cardPath, locator: { kind: "body", line: 12 }, text: "Order lumber", expectedStatus: "open", status: "done",
  });
  console.error = originalError;
  await fs.rm(hook);
  t.check([warned.commit, warned.commitWarning, (await box.read(cardPath)).split("\n")[11]?.startsWith('{% todo status="done"')], [
    null,
    "Saved, but the Git commit failed.",
    true,
  ]);
});
