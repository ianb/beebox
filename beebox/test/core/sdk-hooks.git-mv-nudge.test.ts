// # git-mv-nudge: suggest `bbx mv` over raw `git mv` on box content
//
// `gitMvNudgeHook` is a PreToolUse Bash hook. When the agent runs `git mv` on box
// content (a `store/` path or a `.card`), it injects an advisory to use `bbx mv`
// instead — which rewrites inbound references. It never blocks, and stays quiet for
// non-box moves, `bbx mv`, and non-PreToolUse events.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { gitMvNudgeHook } from "../../src/core/sdk-hooks.js";

const { hooks } = gitMvNudgeHook();

// The `additionalContext` a hook injected, or undefined when it injected none.
function contextOf(out: HookJSONOutput | undefined): string | undefined {
  if (out === undefined || "async" in out) return undefined;
  const specific = out.hookSpecificOutput;
  return specific !== undefined && "additionalContext" in specific ? specific.additionalContext : undefined;
}

// Returns the injected suggestion text, or null when the hook stays quiet.
async function nudge(command: string, event?: "PreToolUse" | "PostToolUse") {
  const base = { session_id: "s", transcript_path: "", cwd: "/", tool_name: "Bash", tool_input: { command }, tool_use_id: "t" };
  const out = await hooks[0]?.(
    event === "PostToolUse" ? { ...base, hook_event_name: "PostToolUse", tool_response: {} } : { ...base, hook_event_name: "PreToolUse" },
    undefined,
    { signal: new AbortController().signal },
  );
  return contextOf(out) ?? null;
}

// `git mv` on a `store/` path nudges toward `bbx mv`:
void test("git mv on a store/ path nudges toward bbx mv:", async (t) => {
  t.check(await nudge("git mv store/old/valley store/new/valley"), "You're using `git mv` on box content. `git mv` relocates files but does NOT rewrite inbound references, so links/refs pointing at the moved content will dangle. Prefer `bbx mv` — it moves the files AND rewrites every reference, including inline links in `.md` dossiers. Use plain `git mv` only if you intentionally want to move without updating references.");
});

// So does a `.card` move outside `store/` (the wrapper still mishandles refs):
void test("So does a .card move outside store/ (the wrapper still mishandles refs):", async (t) => {
  t.check(await nudge("cd box && git mv box/A.doc.card box/sub/A.doc.card"), "You're using `git mv` on box content. `git mv` relocates files but does NOT rewrite inbound references, so links/refs pointing at the moved content will dangle. Prefer `bbx mv` — it moves the files AND rewrites every reference, including inline links in `.md` dossiers. Use plain `git mv` only if you intentionally want to move without updating references.");
});

// It stays quiet for `bbx mv` (already the right tool), a non-box `git mv`, and a
// PostToolUse event (it's a pre-tool nudge):
void test("It stays quiet for bbx mv (already the right tool), a non-box git mv, and a P...", async (t) => {
  t.check(await nudge("bbx mv store/a store/b"), null);

  t.check(await nudge("git mv README.md docs/notes.md"), null);

  t.check(await nudge("git mv store/a store/b", "PostToolUse"), null);
});
