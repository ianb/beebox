// # Agent guide — reaching the boxholder
//
// REACHING_THE_BOXHOLDER is the guide's section on notifying, reminding, and
// watching. The policy lives in the root briefing's "Reaching me" section; a box
// whose briefing predates it gets the default text, quoted into the guide from
// the same constant the briefing template uses, so the two cannot drift.

import { test } from "tap";
import "agent-doctest/tap";
import { any } from "agent-doctest/check";
import { generateAgentGuide } from "../../../../src/core/agent-guide/guide/core.js";
import { reachingDefaultQuote } from "../../../../src/core/agent-guide/guide/reaching.js";
import { createBriefingTemplate, REACHING_ME_DEFAULT } from "../../../../src/schemas/briefing.js";

const guide = generateAgentGuide({ procedures: [], shape: { shapeVersion: 3, boxRoot: "/tmp/b" }, instructionFile: "AGENTS.md" });
const start = guide.indexOf("## REACHING_THE_BOXHOLDER");
const section = guide.slice(start, guide.indexOf("\n## ", start + 1));

// ## The section is in the guide, after the commands
void test("The section is in the guide, after the commands", async (t) => {
  // doctest:L21
  t.check(start, any(Number).between(guide.indexOf("## COMMANDS") + 1, Infinity));

  // doctest:L24
  t.check(section.split("\n")[0], "## REACHING_THE_BOXHOLDER — Notifications, reminders, and watches");
});

// ## The default briefing text is the template's, quoted
void test("The default briefing text is the template's, quoted", async (t) => {
  // doctest:L31
  // The template is a large generated document; only its tail is the constant.
  t.check(createBriefingTemplate(), any(String).endsWith(`---\n${REACHING_ME_DEFAULT}\n`));

  // doctest:L34
  const bodyLines = REACHING_ME_DEFAULT.split("\n").slice(2);
  // The section is large generated text; each quoted line is checked against it.
  for (const line of bodyLines) t.check(section, any(String).includes(line === "" ? ">" : `> ${line}`));

  // doctest:L38
  t.check(section, any(String).includes("> **Reaching me.**"));
  t.check(section, any(String).includes(reachingDefaultQuote()));
});
