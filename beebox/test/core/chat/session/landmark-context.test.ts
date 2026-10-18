// # Box context for a landmark chat
//
// A landmark chat starts in the landmark's directory. Claude Code loads the box
// root's `AGENTS.md` from there but does not expand its `@` includes, so the agent
// guide and the briefing would be missing. `buildLandmarkBoxContext` expands the
// root file the way the harness does at the box root, for the system prompt.

import { test } from "tap";
import "agent-doctest/tap";
import { rm, symlink } from "node:fs/promises";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { buildLandmarkBoxContext } from "../../../../src/core/chat/session/landmark-context.js";

// Each include arrives. The root file's own text does not: Claude Code loads it
// natively from the landmark directory.
void test("Each include arrives.", async (t) => {
  // doctest:L18
  const box = await makeTmpBox();
  await box.write("AGENTS.md", "@guide.md\n@_content/brief.md\n\nHouse rule: be brief.\n");
  await box.write("guide.md", "Guide text.\n");
  await box.write("_content/brief.md", "Briefing text.\n");
  const context = await buildLandmarkBoxContext(box.root);
  t.check(
    {
      framed: context.startsWith("\n\nBOX CONTEXT:\n"),
      rootTextDuplicated: context.includes("House rule: be brief."),
      guide: context.includes("Guide text."),
      briefing: context.includes("Briefing text."),
      includeLines: /^@/m.test(context),
    },
    {
    framed: true,
    rootTextDuplicated: false,
    guide: true,
    briefing: true,
    includeLines: false,
  },
  );

  // doctest:L32
  await box.cleanup();
});

// A box with no root instruction file, or one with no includes, adds nothing.
void test("A box with no root instruction file, or one with no includes, adds nothing.", async (t) => {
  // doctest:L38
  const bare = await makeTmpBox();
  await rm(bare.path("AGENTS.md"), { force: true });
  await t.checkText((await buildLandmarkBoxContext(bare.root)).length, "0");

  // doctest:L43
  await bare.cleanup();
});

// An include that escapes the box throws. The chat start path catches it, logs
// it, and starts the chat without box context, as chats started before box
// context existed (`chat/session/run/start.ts`).
void test("An include that escapes the box throws.", async (t) => {
  // doctest:L51
  const escaping = await makeTmpBox();
  await escaping.write("AGENTS.md", "@../outside.md\n");
  t.check(await buildLandmarkBoxContext(escaping.root).then(() => "ok", (e: unknown) => e instanceof Error ? e.name : "?"), "UnsafeAgentContextIncludeError");

  // doctest:L56
  await escaping.cleanup();
});

// A symlink inside the box that points outside it is refused the same way: the
// include's real path must stay in the box or its engine package.
void test("A symlink inside the box that points outside it is refused the same way:", async (t) => {
  // doctest:L63
  const linked = await makeTmpBox();
  const outside = await makeTmpBox();
  await outside.write("secret.md", "host secret\n");
  await symlink(outside.path("secret.md"), linked.path("notes.md"));
  await linked.write("AGENTS.md", "@notes.md\n");
  t.check(await buildLandmarkBoxContext(linked.root).then((c) => c.includes("host secret") ? "leaked" : "ok", (e: unknown) => e instanceof Error ? e.name : "?"), "UnsafeAgentContextIncludeError");

  // doctest:L71
  await linked.cleanup();
  await outside.cleanup();
});
