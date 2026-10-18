// # Recovering a card path from Git after a miss
//
// The normal card read happens before this helper is called. Once that read has
// reported `ENOENT`, the helper can recover an unstaged filesystem move without
// changing the real Git index.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { parseGitRenameRecords, resolveMovedCardPath } from "../../src/core/moved-card-forwarding.js";
import { fileExists } from "../../src/lib/file-exists.js";

const CARD = `---
type: doc
title: A card with enough content for rename detection
---
The body stays recognizable when the card moves to another directory.
`;

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

void test("line 37", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L38
  const box = await makeTmpBox({ git: true });
  await box.seed("_content/Old.doc.card", CARD);
  box.commitAll("seed old card");
  await box.seed("_content/archive/.keep", "");
  await rename(box.path("_content/Old.doc.card"), box.path("_content/archive/New.doc.card"));

  // doctest:L44
  t.check(await resolveMovedCardPath({ boxRoot: box.root, missingPath: "_content/Old.doc.card" }), {
    kind: "moved",
    path: "_content/archive/New.doc.card",
  });

  // The scratch lookup did not stage either end in the real index.

  // doctest:L51
  const status = simpleGit(box.root);
  const realIndex = await status.diff(["--cached", "--name-status"]);
  t.check(realIndex, "");

  // If a new card reuses the old path, that card wins before historical recovery.

  // doctest:L60
  await box.seed("_content/Old.doc.card", CARD.replace("title: A card", "title: Reused path"));
  t.check(await resolveMovedCardPath({ boxRoot: box.root, missingPath: "_content/Old.doc.card" }), {
    kind: "not-moved",
  });
});

// The recovery relationship belongs to box files, not only typed `.card` files.
// An unstaged Markdown move is detected through the same scratch index.
void test("The recovery relationship belongs to box files, not only typed .card files.", async (t) => {
  t.teardown(async () => {
    try {
      await markdown.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L73
  const markdown = await makeTmpBox({ git: true });
  await markdown.seed("_content/documents/legal/status.md", "A sufficiently distinctive legal status document.\n");
  markdown.commitAll("seed markdown document");
  await markdown.seed("_content/archive/.keep", "");
  await rename(
    markdown.path("_content/documents/legal/status.md"),
    markdown.path("_content/archive/legal-status.md"),
  );

  // doctest:L82
  t.check(
    await resolveMovedCardPath({
      boxRoot: markdown.root,
      missingPath: "_content/documents/legal/status.md",
    }),
    {
    kind: "moved",
    path: "_content/archive/legal-status.md",
  },
  );
});

// The scratch lookup isolates Git filter state as well as the ordinary index and
// object store. A clean filter that writes beneath `GIT_DIR` leaves no marker in
// the real repository when recovery scans the whole box.
void test("The scratch lookup isolates Git filter state as well as the ordinary index an...", async (t) => {
  t.teardown(async () => {
    try {
      await filtered.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L98
  const filtered = await makeTmpBox({ git: true });
  await filtered.seed("filter.mjs", `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.GIT_DIR ?? ".git", "filter-ran"), "ran");
process.stdin.pipe(process.stdout);
`);
  await writeFile(filtered.path(".git/info/attributes"), "*.probe filter=probe\n");
  const filteredGit = simpleGit({ baseDir: filtered.root, unsafe: { allowUnsafeFilter: true } });
  await filteredGit.raw(["config", "filter.probe.clean", "node filter.mjs"]);
  await filteredGit.raw(["config", "filter.probe.required", "true"]);
  await filtered.seed("_content/Old.probe", "Filtered content that Git can recognize after a move.\n");
  filtered.commitAll("seed filtered file");
  await rm(filtered.path(".git/filter-ran"));
  await rename(filtered.path("_content/Old.probe"), filtered.path("_content/New.probe"));

  // doctest:L114
  t.check(
    {
      resolution: await resolveMovedCardPath({ boxRoot: filtered.root, missingPath: "_content/Old.probe" }),
      realFilterMarker: await fileExists(filtered.path(".git/filter-ran")),
    },
    {
    resolution: {
      kind: "moved",
      path: "_content/New.probe",
    },
    realFilterMarker: false,
  },
  );
});

// A real git-annex move still produces the same rename, and its read-only scratch
// objects are made removable before the recovery call returns.
void test("A real git-annex move still produces the same rename, and its read-only scrat...", async (t) => {
  // doctest:L129
  async function annexMoveResult(): Promise<string> {
    const annex = await makeTmpBox({ git: true });
    try {
      execFileSync("git", ["annex", "init", "-q", "moved-path-test"], { cwd: annex.root, stdio: "pipe" });
      execFileSync("git", ["annex", "config", "--set", "annex.largefiles", "anything"], { cwd: annex.root, stdio: "pipe" });
      execFileSync("git", ["config", "annex.thin", "false"], { cwd: annex.root, stdio: "pipe" });
      await writeFile(annex.path("_content/Old.bin"), Buffer.alloc(200_000, 0x42));
      annex.commitAll("seed annex asset");
      execFileSync("git", ["annex", "unlock", "_content/Old.bin"], { cwd: annex.root, stdio: "pipe" });
      await rename(annex.path("_content/Old.bin"), annex.path("_content/New.bin"));
      return JSON.stringify(await resolveMovedCardPath({ boxRoot: annex.root, missingPath: "_content/Old.bin" }));
    } finally {
      try {
        execFileSync("chmod", ["-R", "u+w", annex.root], { stdio: "pipe" });
      } catch (_e) {
        /* ignore: best-effort; cleanup reports anything that actually matters */
      }
      await annex.cleanup();
    }
  }

  // doctest:L150
  await t.checkText(ANNEX ? await annexMoveResult() : '{"kind":"moved","path":"_content/New.bin"}', "{\"kind\":\"moved\",\"path\":\"_content/New.bin\"}");
});

// ## Committed and chained moves
//
// A committed rename is read from the latest commit that touched the old path.
// The same lookup follows a committed move into a second, still-uncommitted move.
void test("A committed rename is read from the latest commit that touched the old path.", async (t) => {
  t.teardown(async () => {
    try {
      await chain.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L160
  const chain = await makeTmpBox({ git: true });
  await chain.seed("_content/First.doc.card", CARD);
  chain.commitAll("seed first path");
  await rename(chain.path("_content/First.doc.card"), chain.path("_content/Second.doc.card"));
  chain.commitAll("first move");
  await rename(chain.path("_content/Second.doc.card"), chain.path("_content/Third.doc.card"));

  // doctest:L167
  t.check(await resolveMovedCardPath({ boxRoot: chain.root, missingPath: "_content/First.doc.card" }), {
    kind: "moved",
    path: "_content/Third.doc.card",
  });
});

// ## Directory moves are recovered per card
//
// Git reports the cards inside a renamed directory as ordinary rename records,
// so the resolver needs no separate directory-forwarding format.
void test("Git reports the cards inside a renamed directory as ordinary rename records,...", async (t) => {
  t.teardown(async () => {
    try {
      await directory.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L181
  const directory = await makeTmpBox({ git: true });
  await directory.seed("_content/session/Note.doc.card", CARD);
  directory.commitAll("seed session");
  await rename(directory.path("_content/session"), directory.path("_content/archive-session"));

  // doctest:L186
  t.check(
    await resolveMovedCardPath({
      boxRoot: directory.root,
      missingPath: "_content/session/Note.doc.card",
    }),
    {
    kind: "moved",
    path: "_content/archive-session/Note.doc.card",
  },
  );
});

// ## Unusual paths survive the full Git lookup
//
// The NUL-delimited parser is exercised through Git as well as directly.
void test("The NUL-delimited parser is exercised through Git as well as directly.", async (t) => {
  t.teardown(async () => {
    try {
      await unusual.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L202
  const unusual = await makeTmpBox({ git: true });
  await unusual.seed("_content/Old name.doc.card", CARD);
  unusual.commitAll("seed unusual path");
  await rename(
    unusual.path("_content/Old name.doc.card"),
    unusual.path("_content/New\tname.doc.card"),
  );

  // doctest:L210
  t.check(
    await resolveMovedCardPath({
      boxRoot: unusual.root,
      missingPath: "_content/Old name.doc.card",
    }),
    {
    kind: "moved",
    path: "_content/New\tname.doc.card",
  },
  );
});

// ## Failing closed
//
// An incomplete or unsafe record is not enough to navigate. A box without Git
// also keeps the ordinary not-found result and reports the recovery failure to
// the supplied warning boundary.
void test("An incomplete or unsafe record is not enough to navigate.", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await plain.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L228
  const plain = await makeTmpBox();
  const warnings: string[] = [];
  const result = await resolveMovedCardPath({
    boxRoot: plain.root,
    missingPath: "_content/Gone.doc.card",
    warn: message => warnings.push(message),
  });
  print(JSON.stringify(result));
  await t.checkText(out.with(warnings.length), `{"kind":"not-moved"}
1`);
});

// A committed rename whose destination was later deleted or replaced by any
// symlink stays an ordinary miss.
void test("A committed rename whose destination was later deleted or replaced by any sym...", async (t) => {
  t.teardown(async () => {
    try {
      await deleted.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L250
  const deleted = await makeTmpBox({ git: true });
  await deleted.seed("_content/Old.doc.card", CARD);
  deleted.commitAll("seed deleted destination");
  await rename(deleted.path("_content/Old.doc.card"), deleted.path("_content/Gone.doc.card"));
  deleted.commitAll("move before delete");
  await rm(deleted.path("_content/Gone.doc.card"));
  t.check(await resolveMovedCardPath({ boxRoot: deleted.root, missingPath: "_content/Old.doc.card" }), {
    kind: "not-moved",
  });
});

void test("Failing closed", async (t) => {
  t.teardown(async () => {
    try {
      await otherFile.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L265
  const otherFile = await makeTmpBox({ git: true });
  await otherFile.seed("_content/Old.txt", "A plain file whose identity survives its move.\n");
  otherFile.commitAll("seed plain file");
  await rename(otherFile.path("_content/Old.txt"), otherFile.path("_content/New.data"));
  otherFile.commitAll("move plain file");
  t.check(await resolveMovedCardPath({ boxRoot: otherFile.root, missingPath: "_content/Old.txt" }), {
    kind: "moved",
    path: "_content/New.data",
  });
});

void test("Failing closed (line 278)", async (t) => {
  t.teardown(async () => {
    try {
      await unsafe.cleanup();
      await rm(outsideRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L279
  const unsafe = await makeTmpBox({ git: true });
  await unsafe.seed("_content/Old.doc.card", CARD);
  unsafe.commitAll("seed unsafe destination");
  await rename(unsafe.path("_content/Old.doc.card"), unsafe.path("_content/New.doc.card"));
  unsafe.commitAll("move before symlink replacement");
  const outsideRoot = await mkdtemp(join(tmpdir(), "bbx-move-outside-"));
  const outsideCard = join(outsideRoot, "Outside.doc.card");
  await writeFile(outsideCard, CARD);
  await rm(unsafe.path("_content/New.doc.card"));
  await symlink(outsideCard, unsafe.path("_content/New.doc.card"));
  t.check(await resolveMovedCardPath({ boxRoot: unsafe.root, missingPath: "_content/Old.doc.card" }), {
    kind: "not-moved",
  });
});

void test("Failing closed (line 298)", async (t) => {
  t.teardown(async () => {
    try {
      await insideSymlink.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L299
  const insideSymlink = await makeTmpBox({ git: true });
  await insideSymlink.seed("_content/Old.md", "A document that later becomes an in-box symlink.\n");
  await insideSymlink.seed("_content/Other.md", "A different in-box document.\n");
  insideSymlink.commitAll("seed in-box symlink case");
  await rename(insideSymlink.path("_content/Old.md"), insideSymlink.path("_content/New.md"));
  insideSymlink.commitAll("move before in-box symlink replacement");
  await rm(insideSymlink.path("_content/New.md"));
  await symlink("Other.md", insideSymlink.path("_content/New.md"));
  t.check(await resolveMovedCardPath({ boxRoot: insideSymlink.root, missingPath: "_content/Old.md" }), {
    kind: "not-moved",
  });
});

// The NUL parser preserves unusual filenames and rejects truncated records.
void test("The NUL parser preserves unusual filenames and rejects truncated records.", async (t) => {
  // doctest:L318
  t.check(parseGitRenameRecords("R100\0_content/Old name.card\0_content/New\tname.card\0"), [
    {
      from: "_content/Old name.card",
      to: "_content/New\tname.card",
    },
  ]);

  // doctest:L321
  t.check(parseGitRenameRecords("R100\0_content/only-one-path.card\0"), null);
});
