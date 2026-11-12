// # Nested AGENTS.md on pi
//
// Claude Code loads a directory's AGENTS.md when a tool touches a file there;
// pi's file tools do the same by appending the file to the tool result, once
// per session. pi's `faux` provider stands in for OpenRouter.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { deliveredGuidancePaths, openPiSession } from "../../../../../src/core/agent/pi-run/session/core.js";
import { grantSecret, setSecret } from "../../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../../src/lib/box-slug.js";
import { makeTmpBox, type TmpBox } from "../../../../helpers/test-helpers.js";

const MODEL = "test/faux";
const faux = fauxProvider({ provider: "openrouter", models: [{ id: MODEL }] });
const createRuntime = async (options: CreateModelRuntimeOptions) => {
  const runtime = await ModelRuntime.create(options);
  runtime.registerNativeProvider(faux.provider);
  return runtime;
};

async function piBox(t: Test): Promise<TmpBox> {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await writeFile(join(box.root, "_config/box.json"), JSON.stringify({ openrouterModels: [{ id: MODEL, label: "Faux" }] }));
  await writeFile(join(box.root, "AGENTS.md"), "Root rule.\n\n@_content/MAP.md\n");
  await writeFile(join(box.root, "_content/MAP.md"), "Content map.\n");
  // Only an include the root already expanded: nothing new to deliver.
  await writeFile(join(box.root, "_content/AGENTS.md"), "@MAP.md\n");
  await mkdir(join(box.root, "_content/recipes"), { recursive: true });
  await writeFile(join(box.root, "_content/recipes/AGENTS.md"), "Add a `- Changed:` note.\n\n@STYLE.md\n");
  await writeFile(join(box.root, "_content/recipes/STYLE.md"), "Metric units.\n");
  await writeFile(join(box.root, "_content/recipes/Soup.recipe.card"), "Soup\n");
  await writeFile(join(box.root, "_content/recipes/Stew.recipe.card"), "Stew\n");
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
  return box;
}

interface Call { name: string; args: Parameters<typeof fauxToolCall>[1] }

/** Run one prompt whose model makes `calls` in turn (an array is one message's parallel calls); return each tool result's text blocks. */
async function toolResults(boxRoot: string, calls: Array<Call | Call[]>): Promise<string[][]> {
  const opened = await openPiSession({ boxRoot, model: MODEL, purpose: "test" }, { createRuntime });
  if (opened.kind !== "session") throw new Error("expected a session");
  const message = (batch: Call | Call[]) => fauxAssistantMessage([batch].flat().map((call) => fauxToolCall(call.name, call.args)));
  faux.setResponses([...calls.map(message), fauxAssistantMessage("done")]);
  await opened.session.prompt("go");
  opened.session.dispose();
  return opened.session.messages.flatMap((m) =>
    m.role === "toolResult" ? [m.content.flatMap((block) => (block.type === "text" ? [block.text] : []))] : []);
}

function captureWarnings(t: Test): unknown[] {
  const warnings: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  t.teardown(() => { console.warn = warn; });
  return warnings;
}

const RECIPES_GUIDANCE = '<nested-agents-md path="_content/recipes/AGENTS.md">\n'
  + "Bee Box added this block; it is not part of the file or the tool's output. "
  + "It holds the instructions for files in _content/recipes/. Follow them.\n\n"
  + "Add a `- Changed:` note.\n\n<!-- beebox include: _content/recipes/STYLE.md -->\nMetric units.\n</nested-agents-md>";

void test("a read delivers its directory's AGENTS.md once, with its includes", async (t) => {
  const box = await piBox(t);
  const results = await toolResults(box.root, [
    { name: "read", args: { path: "_content/recipes/Soup.recipe.card" } },
    { name: "read", args: { path: "_content/recipes/Stew.recipe.card" } },
  ]);
  t.check(results, [["Soup\n", RECIPES_GUIDANCE], ["Stew\n"]]);
  t.check(deliveredGuidancePaths(RECIPES_GUIDANCE), ["_content/recipes/AGENTS.md"]);
});

// The rule arrives with the edit's result, so the model can fix the edit in its next step.
void test("an edit or write delivers it too; reading a whole AGENTS.md without includes counts as delivered", async (t) => {
  const box = await piBox(t);
  const edited = await toolResults(box.root, [
    { name: "edit", args: { path: "_content/recipes/Soup.recipe.card", edits: [{ oldText: "Soup", newText: "Bean soup" }] } },
  ]);
  t.check(edited, [["Successfully replaced 1 block(s) in _content/recipes/Soup.recipe.card.", RECIPES_GUIDANCE]]);
  await mkdir(join(box.root, "_content/notes"));
  await writeFile(join(box.root, "_content/notes/AGENTS.md"), "Date every note.\n");
  const readFirst = await toolResults(box.root, [
    { name: "read", args: { path: "_content/notes/AGENTS.md" } },
    { name: "write", args: { path: "_content/notes/Monday.md", content: "Monday\n" } },
  ]);
  t.check(readFirst, [["Date every note.\n"], ["Successfully wrote to _content/notes/Monday.md"]]);
});

// The read showed one line and none of STYLE.md, so the block still comes.
void test("a partial read of an AGENTS.md with an include gets the whole block", async (t) => {
  const box = await piBox(t);
  const results = await toolResults(box.root, [
    { name: "read", args: { path: "_content/recipes/AGENTS.md", limit: 1 } },
    { name: "read", args: { path: "_content/recipes/Soup.recipe.card" } },
  ]);
  t.check(results, [["Add a `- Changed:` note.\n\n[3 more lines in file. Use offset=2 to continue.]", RECIPES_GUIDANCE], ["Soup\n"]]);
});

// pi runs one message's tool calls at once; the first to reach the file reserves it.
void test("parallel reads in one directory deliver its AGENTS.md once", async (t) => {
  const box = await piBox(t);
  const results = await toolResults(box.root, [[
    { name: "read", args: { path: "_content/recipes/Soup.recipe.card" } },
    { name: "read", args: { path: "_content/recipes/Stew.recipe.card" } },
  ]]);
  t.check(results.flat().filter((text) => text === RECIPES_GUIDANCE), [RECIPES_GUIDANCE]);
});

// The edit already changed the file; a guidance failure must not report it as failed.
void test("an edit keeps its result when the directory's guidance fails to load, and a later touch retries", async (t) => {
  const box = await piBox(t);
  await mkdir(join(box.root, "_content/broken/SUB.md"), { recursive: true });
  await writeFile(join(box.root, "_content/broken/AGENTS.md"), "Keep it short.\n\n@SUB.md\n");
  await writeFile(join(box.root, "_content/broken/note.md"), "Note\n");
  const warnings = captureWarnings(t);
  const note = "[Bee Box could not load the guidance for _content/broken/AGENTS.md. The tool's own result above stands.]";
  t.check(await toolResults(box.root, [
    { name: "edit", args: { path: "_content/broken/note.md", edits: [{ oldText: "Note", newText: "Short note" }] } },
    { name: "read", args: { path: "_content/broken/note.md" } },
  ]), [["Successfully replaced 1 block(s) in _content/broken/note.md.", note], ["Short note\n", note]]);
  t.check(warnings, [
    "[pi] Could not load the guidance for _content/broken/AGENTS.md: EISDIR: illegal operation on a directory, read",
    "[pi] Could not load the guidance for _content/broken/AGENTS.md: EISDIR: illegal operation on a directory, read",
  ]);
});

// A box agent can write a symlink; it must not pull a server file into the prompt.
void test("an AGENTS.md that links outside the box is not delivered", async (t) => {
  const box = await piBox(t);
  const outside = await mkdtemp(join(tmpdir(), "bbx-outside-"));
  t.teardown(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "server.env"), "SERVER_SECRET=1\n");
  await mkdir(join(box.root, "_content/linked"), { recursive: true });
  await symlink(join(outside, "server.env"), join(box.root, "_content/linked/AGENTS.md"));
  await writeFile(join(box.root, "_content/linked/note.md"), "Note\n");
  const warnings = captureWarnings(t);
  t.check(await toolResults(box.root, [{ name: "read", args: { path: "_content/linked/note.md" } }]), [["Note\n"]]);
  t.check(warnings, ["[pi] Not delivering _content/linked/AGENTS.md: it resolves outside the box"]);
});
