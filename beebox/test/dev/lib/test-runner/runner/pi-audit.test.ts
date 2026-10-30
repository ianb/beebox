// # Knowledge audits on pi
//
// A pi audit runs the pi batch agent and reads its session file afterwards
// (docs/plans/pi-box-engine.md, "Knowledge audits"). pi's lowercase tools map
// onto the audit's reads, searches and commands. pi's `faux` provider stands
// in for OpenRouter: nothing here spends.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { grantSecret, setSecret } from "../../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../../src/lib/box-slug.js";
import { piBehaviorFromSession } from "../../../../../src/dev/lib/test-runner/runner/pi-audit.js";
import { runTest, type AuditTest } from "../../../../../src/dev/lib/test-runner/runner/run-test.js";
import { makeTmpBox } from "../../../../helpers/test-helpers.js";

const MODEL = "test/faux";
const faux = fauxProvider({ provider: "openrouter", models: [{ id: MODEL }] });
const piDeps = {
  createRuntime: async (options: CreateModelRuntimeOptions) => {
    const runtime = await ModelRuntime.create(options);
    runtime.registerNativeProvider(faux.provider);
    return runtime;
  },
};

/** A committed pi box: `runTest` refuses a dirty one. */
async function piBox(t: Test) {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await writeFile(join(box.root, "_config/box.json"), JSON.stringify({
    agentEngine: "pi", agentModel: MODEL, openrouterModels: [{ id: MODEL, label: "Faux" }],
  }));
  execSync("git add -A && git commit -qm 'pi box'", { cwd: box.root });
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
  return box;
}

const audit: AuditTest = {
  id: "pi-nested",
  prompt: "Add cumin to the soup.",
  expected_level: "knows_directly",
  watch_for: "reads the recipes AGENTS.md",
  fixture: { "_content/recipes/AGENTS.md": "Mark every change.\n" },
  should_read: ["_content/recipes/AGENTS.md"],
  should_not_read: ["_content/inbox/AGENTS.md"],
  bash_contains: ["rg -l soup"],
};

void test("a pi audit reads pi's tool calls, reply and usage from its session file", async (t) => {
  const box = await piBox(t);
  faux.setResponses([
    fauxAssistantMessage([fauxText("Checking the folder rules."), fauxToolCall("read", { path: "_content/recipes/AGENTS.md" })]),
    fauxAssistantMessage([fauxToolCall("ls", { path: "_content/recipes" }), fauxToolCall("bash", { command: "rg -l soup _content" })]),
    fauxAssistantMessage("Added cumin."),
  ]);
  const result = await runTest({ test: audit, boxRoot: box.root, piDeps });
  t.check(result.engine, "pi");
  t.check(result.behavior, {
    filesRead: ["_content/recipes/AGENTS.md", "rg -l soup _content"],
    searches: [{ tool: "ls", summary: "_content/recipes" }, { tool: "bash", summary: "rg -l soup _content" }],
    bashCommands: ["rg -l soup _content"],
    bashRawCommands: ["rg -l soup _content"],
    responseText: "Checking the folder rules.\nAdded cumin.",
    // The text before the last tool call folds into the activity row.
    replyText: "Added cumin.",
    responseLength: 6,
    context: { initialTokens: any(Number), peakTokens: any(Number), addedTokens: any(Number), turnCount: 3 },
    readsBeforeFirstEdit: null,
  });
  t.check(result.checks.shouldReadChecks, [{ file: "_content/recipes/AGENTS.md", wasRead: true }]);
  t.check(result.checks.shouldNotReadChecks, [{ file: "_content/inbox/AGENTS.md", wasRead: false }]);
  t.check(result.checks.bashContainsChecks, [{ expected: "rg -l soup", found: true, matchedCommand: "rg -l soup _content" }]);
});

// The read tool delivers the folder's AGENTS.md with the card; the audit
// counts that as a read, and `read_before_edit` sees whether it came first.
void test("delivered guidance counts as a read, in order with the edits", async (t) => {
  const box = await piBox(t);
  const card = "_content/recipes/Soup.recipe.card";
  await writeFile(join(box.root, card), "Soup\n");
  execSync("git add -A && git commit -qm soup", { cwd: box.root });
  const ordered: AuditTest = { ...audit, should_not_read: [], bash_contains: [], read_before_edit: ["_content/recipes/AGENTS.md"] };
  const run = async (first: "read" | "edit") => {
    const read = fauxToolCall("read", { path: card });
    const edit = fauxToolCall("edit", { path: card, edits: [{ oldText: "Soup", newText: "Cumin soup" }] });
    faux.setResponses([
      fauxAssistantMessage(first === "read" ? read : edit),
      fauxAssistantMessage(first === "read" ? edit : read),
      fauxAssistantMessage("Added cumin."),
    ]);
    const { behavior, checks } = await runTest({ test: ordered, boxRoot: box.root, piDeps });
    return { filesRead: behavior.filesRead, readsBeforeFirstEdit: behavior.readsBeforeFirstEdit, order: checks.readBeforeEditChecks };
  };
  t.check(await run("read"), {
    filesRead: [card, "_content/recipes/AGENTS.md"],
    readsBeforeFirstEdit: 2,
    order: [{ file: "_content/recipes/AGENTS.md", outcome: "read-first" }],
  });
  // The edit's own result delivers the file, after the edit.
  t.check(await run("edit"), {
    filesRead: ["_content/recipes/AGENTS.md", card],
    readsBeforeFirstEdit: 0,
    order: [{ file: "_content/recipes/AGENTS.md", outcome: "read-after" }],
  });
});

void test("a pi session with no file is a missing transcript, not an empty audit", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await t.checkThrows(
    async () => piBehaviorFromSession(box.root, "never-ran"),
    "KnowledgeAuditTranscriptError: pi knowledge-audit transcript is missing for session never-ran: «*». No audit checks were evaluated.",
  );
});
