// # The code-split CLI bundle's file rules
//
// `dist/cli.mjs` imports hashed `dist/cli-<name>-<hash>.mjs` chunks
// (`src/scripts/build-cli/build/cli-chunks.ts`). Staged files move into
// `dist/` maps first and `cli.mjs` last, so a concurrent `bbx` never loads an
// entry that names a missing chunk. Old chunks are pruned only when none of
// the last three builds wrote them and they are over an hour old, because a
// running dev process may still import one until it reloads.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prunableChunks, recordBuild, stagingOrder } from "../../../../src/scripts/build-cli/build/cli-chunks.js";

void test("Staged files move maps first and cli.mjs last", async (t) => {
  t.check(stagingOrder(["cli.mjs", "cli-ls-AB12CD34.mjs", "cli.mjs.map", "exports/cards.js", "cli-ls-AB12CD34.mjs.map"]), [
    "cli.mjs.map",
    "cli-ls-AB12CD34.mjs.map",
    "cli-ls-AB12CD34.mjs",
    "exports/cards.js",
    "cli.mjs",
  ]);
});

const HOUR = 60 * 60 * 1000;
const now = 10 * HOUR;

// Only chunk files are candidates; a kept build's chunks and anything under an
// hour old survive.
void test("A chunk is pruned only when no kept build wrote it and it is over an hour old", async (t) => {
  const files = [
    { name: "cli-ls-OLD1OLD1.mjs", mtimeMs: now - 2 * HOUR },
    { name: "cli-ls-OLD1OLD1.mjs.map", mtimeMs: now - 2 * HOUR },
    { name: "cli-ls-KEPTKEPT.mjs", mtimeMs: now - 5 * HOUR },
    { name: "cli-ls-NEW1NEW1.mjs", mtimeMs: now - 10 * 60 * 1000 },
    { name: "cli.mjs", mtimeMs: now - 5 * HOUR },
    { name: "pub-worker.js", mtimeMs: now - 5 * HOUR },
    // Not esbuild's chunk shape: a file someone left in dist/ is never pruned.
    { name: "cli-helper.mjs", mtimeMs: now - 5 * HOUR },
  ];
  t.check(prunableChunks({ files, keptBuilds: [["cli-ls-KEPTKEPT.mjs"]], now }), ["cli-ls-OLD1OLD1.mjs", "cli-ls-OLD1OLD1.mjs.map"]);
});

// The manifest keeps the newest three builds, and a missing or torn manifest
// starts a new history rather than failing the build.
void test("recordBuild keeps the newest three builds and survives a torn manifest", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cli-chunks-"));
  const manifest = join(dir, ".cli-builds.json");
  for (const build of [["a"], ["b"], ["c"], ["d"]]) await recordBuild(manifest, build);
  t.check(JSON.parse(await readFile(manifest, "utf8")), [["b"], ["c"], ["d"]]);

  await writeFile(manifest, "{ torn");
  t.check(await recordBuild(manifest, ["e"]), [["e"]]);
});
