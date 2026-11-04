// # What a small pass does not load
//
// The SDK loads a box's own agent context by default — `AGENTS.md`, the generated
// agent guide, `.claude/rules/`. For the reactor, procedure runs and chat that is
// the design. For the small structured passes (chat review, retro observation,
// triage, the procedure judge) it is pure cost: measured on the test box it is
// **~9,700 always-loaded words on every invocation**, and a pass emitting a title
// or a yes/no verdict cannot use any of it
// (`issues/code-quality/2026-07-30-structured-output-passes-load-full-box-context.md`).
//
// `loadBoxContext: false` is how a call site opts out. It reaches the SDK as an
// empty `settingSources`. Every other run loads the box's project settings
// (`AGENTS.md`, `.claude/rules/`, `.claude/skills/`, the box hooks) and nothing
// from the host user's `~/.claude`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { buildQueryOptions, type RunAgentOptions } from "../../../../src/core/agent/invoke/run.js";
import { invariant } from "../../../../src/shared/invariant.js";
import { boxSessionSettings } from "../../../../src/core/agent/box-session-settings.js";

const CONTEXT = { env: {}, maxTurns: 4, binaryPath: null, appendedSystem: "" };
const RUN = { boxRoot: "/box", systemPrompt: "", prompt: "hi" };

function optionsFor(extra: Partial<RunAgentOptions>) {
  return buildQueryOptions({ ...RUN, ...extra }, CONTEXT);
}

/** The `settings` object of the built options (the SDK also accepts a settings file path). */
function settingsFor(extra: Partial<RunAgentOptions>) {
  const { settings } = optionsFor(extra);
  invariant(typeof settings === "object", "settings is an object");
  return settings;
}

// Opting out sets an empty `settingSources`; the default and an explicit `true`
// load only the `project` source.
void test("Opting out sets an empty settingSources; the default and an explicit true loa...", async (t) => {
  t.check(optionsFor({ loadBoxContext: false }).settingSources, []);

  t.check(optionsFor({}).settingSources, [
    "project",
  ]);

  t.check(optionsFor({ loadBoxContext: true }).settingSources, [
    "project",
  ]);
});

// The server's Claude login can carry claude.ai connectors (Gmail, Calendar,
// Drive) for one person's account. A box agent must never get them
// (`issues/closed/bugs/2026-10-08-box-chat-agent-inherits-host-claude-account-connectors.md`),
// so every run turns them off with a flag-level setting. The CLI also loads every
// `CLAUDE.md` in the directories above its working directory, which for a box
// under the host's home directory includes `~/.claude/CLAUDE.md`; those files are
// excluded by path.
void test("The server's Claude login can carry claude.ai connectors (Gmail, Calendar, Dr...", async (t) => {
  t.check(optionsFor({}).settings, {
    disableClaudeAiConnectors: true,
    claudeMdExcludes: [
      "/CLAUDE.md",
      "/AGENTS.md",
      "/CLAUDE.local.md",
      "/.claude/CLAUDE.md",
      "/.claude/AGENTS.md",
      "/.claude/rules/**",
    ],
    attribution: { commit: "", pr: "", sessionUrl: false },
  });

  t.check(settingsFor({ loadBoxContext: false }).disableClaudeAiConnectors, true);
});

// The same host-account built-ins a chat may not use (scheduling, push, the
// account's projects and artifacts; `test/services/claude-chat.test.ts` lists
// them) are off for agent runs too, including runs without box context. The
// list itself is pinned there; this checks only that a run spreads it.
void test("The same host-account built-ins a chat may not use (scheduling, push, the acc...", async (t) => {
  t.check(
    optionsFor({ loadBoxContext: false }).disallowedTools,
    boxSessionSettings({ boxRoot: "/box", loadBoxContext: false }).disallowedTools,
  );
});
