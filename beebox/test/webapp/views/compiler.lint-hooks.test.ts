// # Edit-time view compile check
//
// Agent-authored views (`views/*.tsx`) get a compile check the moment they're
// written — the same edit-time nudge cards already get. The check runs from **both**
// validation hook paths: the shell `bbx validate --hook` (installed
// `.claude/settings.json`) and the in-process `cardValidatorHook()` that agent chat
// and agent-run sessions use. Both call the shared `lintViewFile`, and then, for a
// view that compiles, `lintViewMarkdown`: rendering card text other than through
// `Markdown` is an error of the same weight (`test/core/views/markdown-check.doctest.md`).

import { test } from "tap";
import "agent-doctest/tap";
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
      hook_event_name: "PostToolUse", session_id: "doctest", transcript_path: "", cwd,
      tool_name: "Write", tool_input: { file_path: filePath }, tool_response: null, tool_use_id: "doctest-tool-use",
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
  // doctest:L92
  t.check(
    [
      isViewFile("/box/views/dashboard.tsx"),
      isViewFile("views/foo.tsx"),
      isViewFile("/box/src/components/Foo.tsx"),
      isViewFile("/box/views/sub/nested.tsx"),
      isViewFile("/box/views/notes.md"),
    ].join(","),
    "true,true,false,false,false",
  );
});

// Helpers a view imports live beside it (`views/lib/…`). They are not views,
// but `isViewSourceFile` covers them, so editing one runs the Markdown check
// (and not the compile check):
void test("Helpers a view imports live beside it (views/lib/…).", async (t) => {
  // doctest:L107
  t.check(
    [
      isViewSourceFile("/box/src/views/dashboard.tsx"),
      isViewSourceFile("/box/src/views/lib/prose.tsx"),
      isViewSourceFile("/box/src/views/lib/strip.ts"),
      isViewSourceFile("/box/src/components/Foo.tsx"),
    ].join(","),
    "true,true,true,false",
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
  // doctest:L122
  const viewsDir = await makeViews();
  t.check(await lintViewFile(join(viewsDir, "good.tsx")), null);

  // doctest:L128
  const err = await lintViewFile(join(viewsDir, "broken.tsx"));
  await t.checkText(typeof err === "string" && err.length > 0, "true");
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
  // doctest:L143
  const viewsDir = await makeViews();
  const brokenOut = await runHook(join(viewsDir, "broken.tsx"), viewsDir);
  t.check(contextOf(brokenOut)?.startsWith("View compile error"), true);

  // A view that compiles but renders a body as raw text gets the Markdown rule:

  // doctest:L152
  const rawOut = await runHook(join(viewsDir, "raw.tsx"), viewsDir);
  t.check(contextOf(rawOut)?.includes("Render card text with `Markdown` from `beebox/view-widgets`"), true);

  // Editing a helper under `views/` gets the same rule, naming the helper:

  // doctest:L160
  const helperOut = await runHook(join(viewsDir, "lib", "prose.tsx"), viewsDir);
  t.check(contextOf(helperOut)?.includes("line 1: reads `card.body` outside `<Markdown>`"), true);

  // doctest:L166
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
  // doctest:L181
  const viewsDir = await makeViews();
  const broken = await runShellHook(join(viewsDir, "broken.tsx"));
  t.check(broken.code, 2);

  // doctest:L188
  await t.checkText(broken.stderr.includes("View compile error"), "true");

  // The Markdown rule fails the same way:

  // doctest:L195
  const raw = await runShellHook(join(viewsDir, "raw.tsx"));
  t.check([raw.code, raw.stderr.includes("line 5: reads `card.body` outside `<Markdown>`")].join(" "), "2 true");

  // So does an edited helper:

  // doctest:L203
  const helper = await runShellHook(join(viewsDir, "lib", "prose.tsx"));
  t.check([helper.code, helper.stderr.includes("View renders Markdown by hand")].join(" "), "2 true");

  // A clean view exits 0:

  // doctest:L211
  const good = await runShellHook(join(viewsDir, "good.tsx"));
  t.check(good.code, 0);
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
  // doctest:L224
  const warningBox = await makeTmpBox();
  const instructions = join(warningBox.root, "AGENTS.md");
  await writeFile(instructions, "x".repeat(13000));
  const warning = await runShellHook(instructions);
  t.check(
    {
      code: warning.code,
      context: JSON.parse(warning.stdout).hookSpecificOutput.additionalContext.includes("instruction-file-size"),
      stderr: warning.stderr,
    },
    {
    code: 0,
    context: true,
    stderr: "",
  },
  );
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
  // doctest:L247
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
  t.check(
    [first, repeated, firm, softAgain, firmAgain, clean, afterClean, newSession, corruptCache, recoveredCache, unavailableCache].map((result) => ({
      code: result.code,
      warning: result.stdout.includes("instruction-file-size"),
      stderr: result.stderr,
    })),
    [
    {
      code: 0,
      warning: true,
      stderr: "",
    },
    {
      code: 0,
      warning: false,
      stderr: "",
    },
    {
      code: 0,
      warning: true,
      stderr: "",
    },
    {
      code: 0,
      warning: false,
      stderr: "",
    },
    {
      code: 0,
      warning: false,
      stderr: "",
    },
    {
      code: 0,
      warning: false,
      stderr: "",
    },
    {
      code: 0,
      warning: true,
      stderr: "",
    },
    {
      code: 0,
      warning: true,
      stderr: "",
    },
    {
      code: 0,
      warning: true,
      stderr: "",
    },
    {
      code: 0,
      warning: false,
      stderr: "",
    },
    {
      code: 0,
      warning: true,
      stderr: "",
    },
  ],
  );
});
