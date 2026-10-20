// # `removeTempCwdTranscripts` — cleanup of the real CLI's transcripts for a temp cwd
//
// Tests and probes that run the real Claude CLI with the developer's HOME leave
// a transcript directory per temp cwd in `~/.claude/projects`. The helper
// removes the directory named for the temp cwd and those of its
// subdirectories, and nothing else. `BBX_CLAUDE_PROJECTS_DIR` points the
// projects root at a temp directory here.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { encodeProjectDir, removeTempCwdTranscripts } from "../../../../src/core/chat/session/transcript-paths.js";

void test("The temp cwd's transcript directories go; a sibling and other projects stay", async (t) => {
  t.teardown(async () => {
    try {
      if (previous === undefined) delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      else process.env["BBX_CLAUDE_PROJECTS_DIR"] = previous;
      await fs.rm(projects, { recursive: true, force: true });
      await fs.rm(cwd, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const previous = process.env["BBX_CLAUDE_PROJECTS_DIR"];
  const projects = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-test-projects-"));
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = projects;
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-test-cwd-"));
  // The CLI names the directory after its cwd with symlinks resolved.
  const encoded = encodeProjectDir(await fs.realpath(cwd));
  for (const name of [encoded, `${encoded}-landmark`, `${encoded}x`, "-Users-someone-src-boxes-home"]) {
    await fs.mkdir(path.join(projects, name, "memory"), { recursive: true });
    await fs.writeFile(path.join(projects, name, "s.jsonl"), "{}\n");
  }

  await removeTempCwdTranscripts(cwd);
  t.check((await fs.readdir(projects)).toSorted(), ["-Users-someone-src-boxes-home", `${encoded}x`].toSorted());
});

// A box path, not a temp directory. (Under tap, HOME itself is a temp
// directory, so it would not do.)
void test("A cwd outside the temp directory is refused", async (t) => {
  await t.checkThrows(() => removeTempCwdTranscripts("/srv/boxes/alpha"), `NotATempCwdError: /srv/boxes/alpha is not under the temp directory ${await fs.realpath(os.tmpdir())}; refusing to remove its transcripts`);
});
