// # Edit-time view compile check
//
// Agent-authored views (`views/*.tsx`) get a compile check the moment they're
// written — the same edit-time nudge cards already get. The check runs from **both**
// validation hook paths: the shell `bbx validate --hook` (installed
// `.claude/settings.json`) and the in-process `cardValidatorHook()` that agent chat
// and agent-run sessions use. Both call the shared `lintViewFile`, and then, for a
// view that compiles, `lintViewMarkdown`: rendering card text other than through
// `Markdown` is an error of the same weight (`test/core/views/markdown-check.test.ts`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { spawn } from "node:child_process";
import { isViewFile, isViewSourceFile } from "../../../src/lib/paths/core.js";
import { lintViewFile } from "../../../src/webapp/views/compiler/compile.js";
import { cardValidatorHook } from "../../../src/core/sdk-hooks.js";
import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

const GOOD_VIEW = `
export const name = "Good";
export const dependencies = [];
export const modes = ["page"];
export default function Good() { return <div>ok</div>; }
`;
const BROKEN_VIEW = "export default function Broken() { return <div";
const RAW_BODY_VIEW = `
export const name = "Raw";
export const dependencies = ["_content/**/*.card"];
export const modes = ["page"];
export default function Raw({ cards }) { return cards.map((card) => <p key={card.path}>{card.body}</p>); }
`;

const MARKDOWN_RULE = `View renders Markdown by hand:
  line LINE: reads \`card.body\` outside \`<Markdown>\`
Render card text with \`Markdown\` from \`beebox/view-widgets\`. If it lacks something this view needs, say so in \`_config/feedback/\`.`;

const SIZE_ADVICE = "Trim it, consolidate duplication, or move detail onto a lazier surface (a sibling doc, a nested instruction file, a .claude/rules/ glob, or a skill). See node_modules/beebox/box-docs/reducing-instruction-file.md for concrete strategies.";

/** The shell hook's stdout for a 13000-character instruction file (soft tier). */
const SOFT_STDOUT = `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"warning  AGENTS.md  [instruction-file-size] 13000 chars (~13 KB) — getting large for a file loaded into context every turn; aim to stay under ~12000 chars (~200 lines). ${SIZE_ADVICE}"}}\n`;

/** The same for a 21000-character file (firm tier). */
const FIRM_STDOUT = `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"warning  AGENTS.md  [instruction-file-size] 21000 chars (~21 KB) — too large. This file loads into agent context every turn, and past ~20000 chars Claude reliably drops instructions. Fix it now: ${SIZE_ADVICE}"}}\n`;

const QUIET = { code: 0, stdout: "", stderr: "" };

async function makeViews() {
  const box = await makeTmpBox({ git: true });
  const tmp = box.root;
  const viewsDir = join(tmp, "src", "views");
  await mkdir(viewsDir, { recursive: true });
  await writeFile(join(viewsDir, "good.tsx"), GOOD_VIEW);
  await writeFile(join(viewsDir, "broken.tsx"), BROKEN_VIEW);
  await writeFile(join(viewsDir, "raw.tsx"), RAW_BODY_VIEW);
  await mkdir(join(viewsDir, "lib"));
  await writeFile(join(viewsDir, "lib", "prose.tsx"), "export const Prose = ({ card }) => <p>{card.body}</p>;");
  return viewsDir;
}

// Fire the in-process hook with a PostToolUse payload for an edit of `filePath`.
async function runHook(filePath: string, cwd: string): Promise<HookJSONOutput> {
  const hook = cardValidatorHook().hooks[0];
  if (hook === undefined) throw new Error("cardValidatorHook registered no hook");
  return hook(
    {
      hook_event_name: "PostToolUse", session_id: "test", transcript_path: "", cwd,
      tool_name: "Write", tool_input: { file_path: filePath }, tool_response: null, tool_use_id: "test-tool-use",
    },
    undefined,
    { signal: new AbortController().signal },
  );
}

// The nudge text a hook result carries, if any.
function contextOf(out: HookJSONOutput): string | undefined {
  if (!("hookSpecificOutput" in out)) return undefined;
  const specific = out.hookSpecificOutput;
  return specific !== undefined && "additionalContext" in specific ? specific.additionalContext : undefined;
}

// Run the real CLI (prebuilt by pretest) in hook mode with a PostToolUse
// payload on stdin; resolve its exit code and output channels.
interface ShellHookResult { code: number | null; stdout: string; stderr: string }

function runShellHook(filePath: string, sessionId?: string) {
  return new Promise<ShellHookResult>((resolve) => {
    const child = spawn(process.execPath, [join(PACKAGE_ROOT, "dist/cli.mjs"), "validate", "--hook"], { cwd: dirname(filePath) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += String(d); });
    child.stderr.on("data", (d: Buffer) => { stderr += String(d); });
    child.on("close", (code: number | null) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify({ session_id: sessionId, tool_input: { file_path: filePath } }));
  });
}

// ## The predicate
//
// `isViewFile` matches a `.tsx` directly in a `views/` directory, not other tsx:
void test("isViewFile matches a .tsx directly in a views/ directory, not other tsx:", async (t) => {
  t.check(
    [
      isViewFile("/box/views/dashboard.tsx"),
      isViewFile("views/foo.tsx"),
      isViewFile("/box/src/components/Foo.tsx"),
      isViewFile("/box/views/sub/nested.tsx"),
      isViewFile("/box/views/notes.md"),
    ],
    [true, true, false, false, false],
  );
});

// Helpers a view imports live beside it (`views/lib/…`). They are not views,
// but `isViewSourceFile` covers them, so editing one runs the Markdown check
// (and not the compile check):
void test("Helpers a view imports live beside it (views/lib/…).", async (t) => {
  t.check(
    [
      isViewSourceFile("/box/src/views/dashboard.tsx"),
      isViewSourceFile("/box/src/views/lib/prose.tsx"),
      isViewSourceFile("/box/src/views/lib/strip.ts"),
      isViewSourceFile("/box/src/components/Foo.tsx"),
    ],
    [true, true, true, false],
  );
});

// ## The shared check
//
// `lintViewFile` returns null for a view that compiles, and an error message for
// one that doesn't:
void test("lintViewFile returns null for a view that compiles, and an error message for...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dirname(dirname(viewsDir)), { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const viewsDir = await makeViews();
  t.check(await lintViewFile(join(viewsDir, "good.tsx")), null);

  const err = await lintViewFile(join(viewsDir, "broken.tsx"));
  t.check(err, str`Build failed with 1 error:
${any(String)}/src/views/broken.tsx:1:46: ERROR: Expected ">" but found end of file`);
});

// ## In-process hook (cardValidatorHook)
//
// The hook agent sessions actually run surfaces a broken view's compile error as
// `additionalContext`. A clean view returns an empty result (no nudge):
void test("The hook agent sessions actually run surfaces a broken view's compile error a...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dirname(dirname(viewsDir)), { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const viewsDir = await makeViews();
  const brokenOut = await runHook(join(viewsDir, "broken.tsx"), viewsDir);
  t.check(contextOf(brokenOut), str`View compile error for ${any(String)}/src/views/broken.tsx:
Build failed with 1 error:
${any(String)}/src/views/broken.tsx:1:46: ERROR: Expected ">" but found end of file`);

  // A view that compiles but renders a body as raw text gets the Markdown rule:

  const rawOut = await runHook(join(viewsDir, "raw.tsx"), viewsDir);
  t.check(contextOf(rawOut), str`View error for ${any(String)}/src/views/raw.tsx:\n${MARKDOWN_RULE.replace("LINE", "5")}`);

  // Editing a helper under `views/` gets the same rule, naming the helper:

  const helperOut = await runHook(join(viewsDir, "lib", "prose.tsx"), viewsDir);
  t.check(contextOf(helperOut), str`View error for ${any(String)}/src/views/lib/prose.tsx:\n${MARKDOWN_RULE.replace("LINE", "1")}`);

  const goodOut = await runHook(join(viewsDir, "good.tsx"), viewsDir);
  t.check(goodOut, {});
});

// ## Shell hook (bbx validate --hook)
//
// A broken view through the installed shell hook exits 2 (the nudge contract) with
// the compile error on stderr:
void test("A broken view through the installed shell hook exits 2 (the nudge contract) w...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dirname(dirname(viewsDir)), { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const viewsDir = await makeViews();
  const broken = await runShellHook(join(viewsDir, "broken.tsx"));
  t.check(broken, {
    code: 2,
    stdout: "",
    stderr: str`View compile error for ${any(String)}/src/views/broken.tsx:
Build failed with 1 error:
${any(String)}/src/views/broken.tsx:1:46: ERROR: Expected ">" but found end of file
`,
  });

  // The Markdown rule fails the same way:

  const raw = await runShellHook(join(viewsDir, "raw.tsx"));
  t.check(raw, { code: 2, stdout: "", stderr: str`View error for ${any(String)}/src/views/raw.tsx:\n${MARKDOWN_RULE.replace("LINE", "5")}\n` });

  // So does an edited helper:

  const helper = await runShellHook(join(viewsDir, "lib", "prose.tsx"));
  t.check(helper, { code: 2, stdout: "", stderr: str`View error for ${any(String)}/src/views/lib/prose.tsx:\n${MARKDOWN_RULE.replace("LINE", "1")}\n` });

  // A clean view exits 0:

  const good = await runShellHook(join(viewsDir, "good.tsx"));
  t.check(good, { code: 0, stdout: "", stderr: "" });
});

// A soft instruction-size warning exits 0 and reaches the agent through the
// `PostToolUse` JSON context channel, without a failing tool result:
void test("A soft instruction-size warning exits 0 and reaches the agent through the Pos...", async (t) => {
  t.teardown(async () => {
    try {
      await warningBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const warningBox = await makeTmpBox();
  const instructions = join(warningBox.root, "AGENTS.md");
  await writeFile(instructions, "x".repeat(13000));
  const warning = await runShellHook(instructions);
  t.check(warning, { code: 0, stdout: SOFT_STDOUT, stderr: "" });
});

// ## Repeated instruction-size warnings
//
// One session sees a size tier once for each file. A larger character count in
// the same tier stays quiet; crossing to the firm tier warns again. A clean edit
// resets the notice, and another session gets its own notice.
void test("One session sees a size tier once for each file.", async (t) => {
  t.teardown(async () => {
    try {
      await repeatBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const repeatBox = await makeTmpBox();
  const repeatFile = join(repeatBox.root, "AGENTS.md");
  await writeFile(repeatFile, "x".repeat(13000));
  const first = await runShellHook(repeatFile, "session-one");
  await writeFile(repeatFile, "x".repeat(13100));
  const repeated = await runShellHook(repeatFile, "session-one");
  await writeFile(repeatFile, "x".repeat(21000));
  const firm = await runShellHook(repeatFile, "session-one");
  await writeFile(repeatFile, "x".repeat(19000));
  const softAgain = await runShellHook(repeatFile, "session-one");
  await writeFile(repeatFile, "x".repeat(21010));
  const firmAgain = await runShellHook(repeatFile, "session-one");
  await writeFile(repeatFile, "small");
  const clean = await runShellHook(repeatFile, "session-one");
  await writeFile(repeatFile, "x".repeat(13000));
  const afterClean = await runShellHook(repeatFile, "session-one");
  const newSession = await runShellHook(repeatFile, "session-two");
  const cacheFile = join(repeatBox.root, ".beebox", "validate-hook-warnings.json");
  await writeFile(cacheFile, "{");
  const corruptCache = await runShellHook(repeatFile, "session-one");
  const recoveredCache = await runShellHook(repeatFile, "session-one");
  await rm(cacheFile);
  await mkdir(cacheFile);
  const unavailableCache = await runShellHook(repeatFile, "session-one");
  t.check([first, repeated, firm, softAgain, firmAgain, clean, afterClean, newSession, corruptCache, recoveredCache, unavailableCache], [
    { code: 0, stdout: SOFT_STDOUT, stderr: "" },
    QUIET,
    { code: 0, stdout: FIRM_STDOUT, stderr: "" },
    QUIET,
    QUIET,
    QUIET,
    { code: 0, stdout: SOFT_STDOUT, stderr: "" },
    { code: 0, stdout: SOFT_STDOUT, stderr: "" },
    { code: 0, stdout: SOFT_STDOUT, stderr: "" },
    QUIET,
    { code: 0, stdout: SOFT_STDOUT, stderr: "" },
  ]);
});
