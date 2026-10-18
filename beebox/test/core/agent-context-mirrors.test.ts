// # Agent context mirrors
//
// Claude-authored context stays canonical and editable. Codex aliases it with
// relative symlinks, while Claude-only rules become generated Codex skills.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateAgentContextMirrors } from "../../src/core/agent-context-mirrors.js";

const root = await mkdtemp(join(tmpdir(), "bbx-context-"));
await mkdir(join(root, ".beebox"), { recursive: true });
await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { "beebox": "*" } }));
await writeFile(join(root, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
await mkdir(join(root, ".claude/skills/calendar"), { recursive: true });
await mkdir(join(root, ".claude/rules"), { recursive: true });
await mkdir(join(root, "node_modules/beebox/plugins/beebox-codex/hooks"), { recursive: true });
await mkdir(join(root, "nested"), { recursive: true });
// Parked template copies are not active guidance; the walk must skip them.
await mkdir(join(root, "_config/_template-updates/_config"), { recursive: true });
await writeFile(join(root, "_config/_template-updates/_config/CLAUDE.md"), "# Parked\n");
await writeFile(join(root, "CLAUDE.md"), "# Box\n");
await writeFile(join(root, "nested/CLAUDE.md"), "# Nested\n");
await writeFile(join(root, ".claude/skills/calendar/SKILL.md"), "# Calendar\n");
await writeFile(join(root, ".claude/rules/card-doc.md"), `---
paths:
  - "**/*.doc.card"
---

# Doc rules
`);
await writeFile(join(root, "node_modules/beebox/plugins/beebox-codex/hooks/hooks.json"), "{}");
await mkdir(join(root, ".agents/skills/callback-box-rule-card-doc"), { recursive: true });
await writeFile(join(root, ".agents/skills/callback-box-rule-card-doc/SKILL.md"), "retired mirror\n");
await generateAgentContextMirrors(root);

// The editable files are symlinked, including nested context:
void test("The editable files are symlinked, including nested context:", async (t) => {
  // doctest:L42
  t.check(await readlink(join(root, "AGENTS.md")), "CLAUDE.md");

  // doctest:L45
  t.check(await readlink(join(root, "nested/AGENTS.md")), "CLAUDE.md");

  // A parked template copy gets no mirror — it is not guidance this box has
  // adopted, and the mirror would dangle once the parked copy is accepted or
  // discarded:

  // doctest:L54
  t.check(await readlink(join(root, "_config/_template-updates/_config/AGENTS.md")).then(() => "mirrored", () => "skipped"), "skipped");

  // doctest:L59
  t.check(await readlink(join(root, ".agents/skills/calendar")), "../../.claude/skills/calendar");

  // doctest:L62
  const hooks = await readFile(join(root, ".codex/hooks.json"), "utf8");
  await t.checkText(hooks.includes("$CLAUDE_PROJECT_DIR/node_modules/beebox/plugins/beebox-codex/scripts/run-bbx.sh"), "true");

  // doctest:L66
  await t.checkText(hooks.includes("$PLUGIN_ROOT"), "false");
});

// Rules are copied into provider-valid skills:
void test("Rules are copied into provider-valid skills:", async (t) => {
  // doctest:L73
  await t.checkText((await readFile(join(root, ".agents/skills/beebox-rule-card-doc/SKILL.md"), "utf8")).includes("# Doc rules"), "true");

  // doctest:L76
  await t.checkText((await readFile(join(root, ".agents/skills/beebox-rule-card-doc/SKILL.md"), "utf8")).includes("**/*.doc.card"), "true");

  // doctest:L79
  t.check(await readFile(join(root, ".agents/skills/callback-box-rule-card-doc/SKILL.md"), "utf8").then(() => false, () => true), true);
});
