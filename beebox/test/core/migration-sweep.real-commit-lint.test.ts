// # The sweep's commit runs the box's real commit lint
//
// A migration's commit goes through the box's own pre-commit hook, which runs
// `bbx validate --pre-commit` on every staged card. The other sweep tests stand
// in for that hook with a grep; this one installs the real hooks
// (`installValidationHooks`, pinned to this checkout's `bbx` by `BBX_HOOK_BIN`)
// so a migration that writes a card the lint refuses is seen to fail the way it
// fails on a box. 2026-10-20: a repair question quoting a machine path failed to
// commit on production, and no test had run the real lint.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../src/core/migrations.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import { installValidationHooks } from "../../src/core/install-validation-hooks.js";
import { sweepMigrations } from "../../src/core/migration-sweep.js";

const PROBE = "annex-config-2026-08";
const CARD = "_content/Note.doc.card";
// A real home directory in card content is an error-level lint finding
// (`absolute-path`). Assembled so the repository's own path-leak check, which
// reads this file, does not see it.
const HOME = ["", "Users", "someone", ""].join("/");
const LEAKING = `---\ntitle: Note\n---\nSaved from ${HOME}Desktop/note.txt\n`;
const CLEAN = "---\ntitle: Note\n---\nSaved from the desktop.\n";

async function seedManifest(box: TmpBox) {
  const lines = MIGRATIONS.filter((m) => m.name !== PROBE).map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00.000Z" }));
  await box.write(MANIFEST_PATH, lines.join("\n") + "\n");
}

function git(box: TmpBox, ...args: string[]) {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}

/** A box with the migration pending, `body` committed as the card before the hooks are installed, and the real hooks. */
async function boxWithRealHooks(t: { teardown: (fn: () => Promise<void>) => void }, body: string): Promise<TmpBox> {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await seedManifest(box);
  await box.write(CARD, body);
  await box.commitAll("seed");
  const before = process.env["BBX_HOOK_BIN"];
  process.env["BBX_HOOK_BIN"] = join(PACKAGE_ROOT, "bin/bbx");
  try {
    await installValidationHooks(box.root);
  } finally {
    if (before === undefined) delete process.env["BBX_HOOK_BIN"]; else process.env["BBX_HOOK_BIN"] = before;
  }
  return box;
}

void test("a migration that rewrites a card the lint refuses cannot commit, and is not recorded", async (t) => {
  const box = await boxWithRealHooks(t, LEAKING);
  const runScript = async () => { await box.write(CARD, LEAKING.replace("Saved", "Kept")); return 0; };
  const result = await sweepMigrations({ boxRoot: box.root, runScript });
  t.check(
    { status: result.status, error: result.status === "commit-failed" ? result.error : "", recorded: (await readFile(join(box.root, MANIFEST_PATH), "utf8")).includes(PROBE), head: git(box, "log", "-1", "--format=%s") },
    {
      status: "commit-failed",
      error: any(String).includes(`Absolute machine path in card content: ${HOME}`),
      recorded: false,
      head: "seed",
    },
  );
});

void test("a migration that rewrites a clean card commits through the real hook", async (t) => {
  const box = await boxWithRealHooks(t, CLEAN);
  const runScript = async () => { await box.write(CARD, CLEAN.replace("Saved", "Kept")); return 0; };
  const result = await sweepMigrations({ boxRoot: box.root, runScript });
  t.check(
    { status: result.status, recorded: (await readFile(join(box.root, MANIFEST_PATH), "utf8")).includes(PROBE), head: git(box, "log", "-1", "--format=%s"), card: git(box, "show", `HEAD:${CARD}`) },
    { status: "applied", recorded: true, head: `Apply migration: ${PROBE}`, card: CLEAN.replace("Saved", "Kept").trimEnd() },
  );
});
