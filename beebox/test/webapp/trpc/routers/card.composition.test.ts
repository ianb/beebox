// # `card.readComposition` / `card.writeComposition`
//
// The composition editor reads a doc card's `{% composition %}` text with a
// region hash, and writes it back with that hash as the precondition
// (`docs/plans/composition-editor.md`, Track 4). The write replaces only the
// region, so an agent's edit elsewhere in the card does not conflict and
// survives. `commit: true` is Save: it commits the card with webapp trailers.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

const events: string[] = [];
const caller = (boxRoot: string) => appRouter.createCaller(trpcContext({
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
}));

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** The error code and message a refused call rejects with, or "accepted". */
function outcome(promise: Promise<unknown>): Promise<string> {
  return promise.then(() => "accepted", (error: unknown) => (error instanceof TRPCError ? `${error.code}: ${error.message}` : String(error)));
}

/** The region hash is the SHA-256 of the region text, without its final newline. */
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const cardPath = "_content/Letter.doc.card";
const card = (notes: string, draft: string) => `---\ntitle: Letter\n---\n${notes}\n\n{% composition %}\n${draft}\n{% /composition %}\n`;

void test("composition read and write", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await box.write(cardPath, card("Notes.", "Dear Sam,\n\nThanks."));
  await box.write("_content/Soup.recipe.card", "---\ntitle: Soup\n---\nBody\n");
  box.commitAll("seed");
  const c = caller(box.root);

  // ## Read returns the region text and its hash

  const read = await c.card.readComposition({ path: cardPath });
  t.check(read, { text: "Dear Sam,\n\nThanks.", regionHash: sha("Dear Sam,\n\nThanks.") });
  if (!("text" in read)) throw new Error("expected a region");

  // ## Autosave replaces only the region and makes no commit

  const head = git(box.root, "rev-parse", "HEAD");
  events.length = 0;
  const saved = await c.card.writeComposition({ path: cardPath, baseRegionHash: read.regionHash, text: "Dear Sam,\n\nThank you.", commit: false });
  t.check(saved, { status: "written", regionHash: sha("Dear Sam,\n\nThank you."), commit: null, commitWarning: null });
  t.check(await box.read(cardPath), card("Notes.", "Dear Sam,\n\nThank you."));
  t.check(git(box.root, "rev-parse", "HEAD"), head);
  t.check(events, ["file-change _content/Letter.doc.card"]);
  if (saved.status !== "written") throw new Error("expected a write");

  // ## An agent's edit outside the region does not conflict, and survives

  await box.write(cardPath, card("Notes, revised by the agent.", "Dear Sam,\n\nThank you."));
  const next = await c.card.writeComposition({ path: cardPath, baseRegionHash: saved.regionHash, text: "Dear Sam,\n\nThank you!", commit: false });
  t.check(next, { status: "written", regionHash: sha("Dear Sam,\n\nThank you!"), commit: null, commitWarning: null });
  t.check(await box.read(cardPath), card("Notes, revised by the agent.", "Dear Sam,\n\nThank you!"));

  // ## A stale base hash is a conflict carrying the current region; nothing is written

  await box.write(cardPath, card("Notes, revised by the agent.", "Dear Samuel,\n\nThank you!"));
  const stale = await c.card.writeComposition({ path: cardPath, baseRegionHash: saved.regionHash, text: "Mine", commit: true });
  const current = await c.card.readComposition({ path: cardPath });
  t.check(stale, { status: "conflict", text: "Dear Samuel,\n\nThank you!", regionHash: sha("Dear Samuel,\n\nThank you!") });
  t.check(await box.read(cardPath), card("Notes, revised by the agent.", "Dear Samuel,\n\nThank you!"));
  if (!("text" in current)) throw new Error("expected a region");

  // ## Save writes the given text and commits the card with the trailers

  const committed = await c.card.writeComposition({ path: cardPath, baseRegionHash: current.regionHash, text: "Dear Samuel,\n\nThanks!", commit: true });
  t.check(committed, { status: "written", regionHash: sha("Dear Samuel,\n\nThanks!"), commit: any(String), commitWarning: null });
  t.check(await box.read(cardPath), card("Notes, revised by the agent.", "Dear Samuel,\n\nThanks!"));
  t.checkText(git(box.root, "log", "-1", "--format=%s%n%(trailers:only,unfold)"), `Save composition: _content/Letter.doc.card
Source: webapp
Endpoint: card.writeComposition
Composition-Save: person`);
  t.check(git(box.root, "status", "--porcelain"), "");

  // A second Save of the same text has nothing to commit, and is not an error.

  if (committed.status !== "written") throw new Error("expected a write");
  events.length = 0;
  t.check(
    await c.card.writeComposition({ path: cardPath, baseRegionHash: committed.regionHash, text: "Dear Samuel,\n\nThanks!", commit: true }),
    { status: "written", regionHash: committed.regionHash, commit: null, commitWarning: null },
  );
  t.check(events, []);

  // ## Text that would break the region is refused before writing

  t.check(
    await outcome(c.card.writeComposition({ path: cardPath, baseRegionHash: committed.regionHash, text: "{% composition %}", commit: false })),
    "PRECONDITION_FAILED: The text would break the composition (multiple); nothing was written",
  );
  // A closing tag in the text would end the region early and save the rest outside it.
  t.check(
    await outcome(c.card.writeComposition({ path: cardPath, baseRegionHash: committed.regionHash, text: "Kept.\n{% /composition %}\nOutside.", commit: false })),
    "PRECONDITION_FAILED: The text would break the composition (closed-early); nothing was written",
  );
  t.check(await box.read(cardPath), card("Notes, revised by the agent.", "Dear Samuel,\n\nThanks!"));

  // ## A non-doc card is rejected

  t.check(await outcome(c.card.readComposition({ path: "_content/Soup.recipe.card" })), "BAD_REQUEST: A composition can only be in a doc card");
  t.check(
    await outcome(c.card.writeComposition({ path: "_content/Soup.recipe.card", baseRegionHash: "x", text: "", commit: false })),
    "BAD_REQUEST: A composition can only be in a doc card",
  );

  // ## A removed composition reads as `problem: "none"` and refuses writes

  await box.write(cardPath, "---\ntitle: Letter\n---\nNotes only.\n");
  t.check(await c.card.readComposition({ path: cardPath }), { problem: "none" });
  t.check(
    await outcome(c.card.writeComposition({ path: cardPath, baseRegionHash: committed.regionHash, text: "Hi", commit: false })),
    "PRECONDITION_FAILED: The card's composition cannot be edited (none)",
  );
});
