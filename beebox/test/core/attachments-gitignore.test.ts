// # `bbx attachments unignore`
//
// The inverse of `init-gitignore`, for the git-annex migration: drop the asset
// ignore block so `git add` can see assets at all. See
// `src/core/attachments-gitignore.ts`.
//
// This is a **required** migration step, not a tidy-up. `annex.largefiles` is
// consulted by `git add`, which never sees an ignored path — so leaving the block
// in place produces a box where no asset is annexed and nothing reports it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import { spawnSync } from "node:child_process";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { runUnignore } from "../../src/core/attachments-gitignore.js";
import type { CommandContext } from "../../src/core/command-runner.js";
import { assetGitignorePatterns } from "../../src/lib/asset-extensions.js";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Put a RETIRED manifest-scheme asset block into a box `.gitignore`.
 *
 * Nothing writes this block any more — every box is annex-shaped from
 * creation. It is spelled out here rather than produced by a writer because
 * the condition under test is a box whose `.gitignore` was hand-edited back to
 * hiding assets, which is exactly what `unignore` repairs.
 */
async function installLegacyAssetBlock(boxRoot: string): Promise<void> {
  await appendFile(
    join(boxRoot, ".gitignore"),
    `\n# bbx-assets (managed by bbx attachments init-gitignore)\n${assetGitignorePatterns()}\n`,
  );
}

/** A CommandContext that collects what the subcommands write. */
function ctxFor(root: string): CommandContext & { lines: string[] } {
  const lines: string[] = [];
  return { boxRoot: root, write: (s: string) => { lines.push(s); }, writeLine: (s: string) => { lines.push(s); }, lines };
}

function checkIgnore(boxRoot: string, boxRelativePath: string): { ignored: boolean; rule: string } {
  const result = spawnSync(
    "git",
    ["check-ignore", "-v", "--no-index", "--", boxRelativePath],
    { cwd: boxRoot, encoding: "utf-8" },
  );
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr);
  const source = result.stdout.split("\t")[0] ?? "";
  const rule = source.split(":").at(-1) ?? "";
  return { ignored: result.status === 0 && !rule.startsWith("!"), rule };
}

// Starting from a box with the asset block installed, `unignore` removes the
// extension patterns and leaves the capture-staging rule behind:
void test("Starting from a box with the asset block installed, unignore removes the exte...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await installLegacyAssetBlock(box.root);
  // A large generated file: keep the narrow check.
  t.check(await box.read(".gitignore"), any(String).includes("**/*.attach/**/*.jpg"));

  const c2 = ctxFor(box.root);
  const res = await runUnignore(c2);
  t.check(res, { success: true, data: { changed: true } });

  // The extension patterns are gone — every asset type, not just the common ones:

  const after = await box.read(".gitignore");
  t.check(after, not(any(String).matches(/\*\*\/\*\.attach\/\*\*\/\*\.(jpg|pdf|frozen)/)));

  // But capture staging stays ignored, because a pre-triage capture must not be
  // annexed before an agent files it:

  t.check(after, any(String).includes("**/tmp-capture/**/*.attach/**"));

  // The broad staging rule must not swallow the committed metadata alongside the
  // media. The directory negation is load-bearing here: without it Git will not
  // re-include a manifest below a nested child `.attach/` directory.

  await box.write("tmp-capture/cap.attach/photo-001.image.card", "card");
  await box.write("tmp-capture/cap.attach/photo-001.attach/manifest.json", "{}");
  await box.write("tmp-capture/cap.attach/audio-001.attach/audio-001.timing.json", "{}");
  await box.write("tmp-capture/cap.attach/photo-001.attach/photo-001.jpg", "media");
  t.check(
    [
      checkIgnore(box.root, "tmp-capture/cap.attach/photo-001.image.card"),
      checkIgnore(box.root, "tmp-capture/cap.attach/photo-001.attach/manifest.json"),
      checkIgnore(box.root, "tmp-capture/cap.attach/audio-001.attach/audio-001.timing.json"),
      checkIgnore(box.root, "tmp-capture/cap.attach/photo-001.attach/photo-001.jpg"),
    ],
    [
    {
      ignored: false,
      rule: "!**/tmp-capture/**/*.attach/**/*.card",
    },
    {
      ignored: false,
      rule: "!**/tmp-capture/**/*.attach/**/manifest.json",
    },
    {
      ignored: false,
      rule: "!**/tmp-capture/**/*.attach/**/*.timing.json",
    },
    {
      ignored: true,
      rule: "**/tmp-capture/**/*.attach/**",
    },
  ],
  );

  // The rule is unanchored. Delivery targets `<contextDir>/tmp-capture/`, not only
  // the box root, so a root-anchored rule would miss real captures and annex them
  // on arrival:

  await box.write("landmarks/trip/tmp-capture/cap.attach/photo-002.jpg", "media");
  t.check(checkIgnore(box.root, "landmarks/trip/tmp-capture/cap.attach/photo-002.jpg"), {
    ignored: true,
    rule: "**/tmp-capture/**/*.attach/**",
  });

  // Re-running is idempotent — it reports no change rather than stacking blocks:

  const c3 = ctxFor(box.root);
  await runUnignore(c3);
  t.check(c3.lines, ["Already converted for git-annex — no change."]);

  // An asset rule sitting OUTSIDE the managed block is a hard failure, not a silent
  // pass. Marker-presence is the wrong test: a hand-edited `.gitignore` that still
  // ignores `.jpg` would leave those assets reaching neither git nor the annex, and
  // nothing else reports it.

  await box.write(".gitignore", "**/*.attach/**/*.jpg\nnode_modules/\n");
  const c4 = ctxFor(box.root);
  const stray = await runUnignore(c4);
  t.check({ success: stray.success, lines: c4.lines }, {
    success: false,
    lines: [
      `.gitignore still ignores assets outside the managed block:
  **/*.attach/**/*.jpg
Remove these by hand — while they are present those assets reach neither git nor the annex, and nothing else reports it.`,
    ],
  });
});

// On a box that never had the asset block (a fresh box, or one already
// hand-edited), `unignore` still installs the capture-staging rule rather than
// no-op'ing — the rule is required either way:
void test("On a box that never had the asset block (a fresh box, or one already hand-edi...", async (t) => {
  const fresh = await makeTmpBox();
  const c = ctxFor(fresh.root);
  await runUnignore(c);
  t.check(await fresh.read(".gitignore"), any(String).includes("**/tmp-capture/**/*.attach/**"));

  await fresh.cleanup();
});

// An existing annex box carrying the old managed block is refreshed in place,
// so rerunning `bbx attachments unignore` is the migration path:
void test("An existing annex box carrying the old managed block is refreshed in place, s...", async (t) => {
  t.teardown(async () => {
    try {
      await anchored.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const stale = await makeTmpBox({ git: true });
  await stale.write(
    ".gitignore",
    "# bbx-assets (managed by bbx attachments unignore)\n**/tmp-capture/**/*.attach/**\n",
  );
  const c = ctxFor(stale.root);
  const refreshed = await runUnignore(c);
  t.check(refreshed, { success: true, data: { changed: true } });
  t.check(c.lines, ["Refreshed the git-annex block in .gitignore."]);
  t.check(await stale.read(".gitignore"), any(String).includes("!**/tmp-capture/**/*.attach/**/manifest.json"));
  await stale.cleanup();

  // ## A path-anchored stray rule is still a stray rule
  //
  // The one-root migration carried a v2 box's own `.gitignore` rules across
  // verbatim, and that box spelled the same patterns path-anchored:
  // `/_content/**/*.attach/**/*.jpg` rather than `**/*.attach/**/*.jpg`. Both hide
  // exactly the same files from `git add`.
  //
  // The stray-rule check matched only the second spelling, so on a box holding the
  // first, `unignore` reported success and `to-annex` converted a box whose every
  // asset stayed ignored — reaching neither git nor the annex, with the annex-shape
  // probe reporting the box as converted. One production box was in that state.

  const anchored = await makeTmpBox({ git: true });
  await installLegacyAssetBlock(anchored.root);
  await anchored.write(
    ".gitignore",
    `${await anchored.read(".gitignore")}\n# Migrated local rules\n/_content/**/*.attach/**/*.jpg\n`,
  );
  const strayResult = await runUnignore(ctxFor(anchored.root));
  t.check({ success: strayResult.success, error: strayResult.error }, {
    success: false,
    error: "1 unmanaged asset ignore rule(s)",
  });

  // The rule really does hide an asset, which is what makes refusing correct:

  t.check(checkIgnore(anchored.root, "_content/photos.attach/a.jpg"), { ignored: true, rule: "/_content/**/*.attach/**/*.jpg" });

  // Removing it by hand is what the message asks for, and then `unignore` proceeds:

  await anchored.write(
    ".gitignore",
    (await anchored.read(".gitignore")).split("\n").filter((l) => !l.includes("/_content/**/*.attach/")).join("\n"),
  );
  const ok = await runUnignore(ctxFor(anchored.root));
  t.check({ success: ok.success, stillIgnored: checkIgnore(anchored.root, "_content/photos.attach/a.jpg").ignored }, {
    success: true,
    stillIgnored: false,
  });

  // The capture-staging re-includes share that middle and must not read as stray —
  // they are negations, and the managed block would otherwise look like a pile of
  // unmanaged rules:

  t.check(await anchored.read(".gitignore"), any(String).includes("!**/tmp-capture/**/*.attach/**/*.card"));
});
