// # Box context for a landmark chat
//
// A landmark chat starts in the landmark's directory. Claude Code loads the box
// root's `AGENTS.md` from there but does not expand its `@` includes, so the agent
// guide and the briefing would be missing. `buildLandmarkBoxContext` expands the
// root file the way the harness does at the box root, for the system prompt.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { rm, symlink } from "node:fs/promises";
import { instanceOf } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { UnsafeAgentContextIncludeError } from "../../../../src/core/agent-context-includes.js";
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
  t.check(context, `

BOX CONTEXT:
This chat starts in a landmark directory, below the box root. The box root's instruction file loads, but its includes do not; they follow. The landmark directory's own instructions also apply, and take precedence for this chat.

<!-- beebox include: guide.md -->
Guide text.

<!-- beebox include: _content/brief.md -->
Briefing text.`);

  // doctest:L32
  await box.cleanup();
});

// A box with no root instruction file, or one with no includes, adds nothing.
void test("A box with no root instruction file, or one with no includes, adds nothing.", async (t) => {
  // doctest:L38
  const bare = await makeTmpBox();
  await rm(bare.path("AGENTS.md"), { force: true });
  t.check(await buildLandmarkBoxContext(bare.root), "");

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
  const escapeError = await buildLandmarkBoxContext(escaping.root).then(() => null, (e: unknown) => e);
  t.check(escapeError, instanceOf(UnsafeAgentContextIncludeError));
  t.check(escapeError, {
    name: "UnsafeAgentContextIncludeError",
    message: "Agent context include must stay inside the box package",
    specifier: "../outside.md",
  });

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
  const linkError = await buildLandmarkBoxContext(linked.root).then(() => null, (e: unknown) => e);
  t.check(linkError, instanceOf(UnsafeAgentContextIncludeError));
  t.check(linkError, {
    name: "UnsafeAgentContextIncludeError",
    message: "Agent context include must stay inside the box package",
    specifier: "notes.md",
  });

  // doctest:L71
  await linked.cleanup();
  await outside.cleanup();
});
