# git-mv-nudge: suggest `bbx mv` over raw `git mv` on box content

`gitMvNudgeHook` is a PreToolUse Bash hook. When the agent runs `git mv` on box
content (a `store/` path or a `.card`), it injects an advisory to use `bbx mv`
instead — which rewrites inbound references. It never blocks, and stays quiet for
non-box moves, `bbx mv`, and non-PreToolUse events.

```ts setup
import { gitMvNudgeHook } from "../../src/core/sdk-hooks.js";

const { hooks } = gitMvNudgeHook();

// Returns the injected suggestion text, or null when the hook stays quiet.
async function nudge(command, event = "PreToolUse") {
  const out = await hooks[0]?.({
    hook_event_name: event,
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "t",
  });
  return out?.hookSpecificOutput?.additionalContext ?? null;
}
```

`git mv` on a `store/` path nudges toward `bbx mv`:

```ts
(await nudge("git mv store/old/valley store/new/valley"))?.includes("bbx mv")
=> true
```

So does a `.card` move outside `store/` (the wrapper still mishandles refs):

```ts
(await nudge("cd box && git mv box/A.memo.card box/sub/A.memo.card"))?.includes("bbx mv")
=> true
```

It stays quiet for `bbx mv` (already the right tool), a non-box `git mv`, and a
PostToolUse event (it's a pre-tool nudge):

```ts
await nudge("bbx mv store/a store/b")
=> null

await nudge("git mv README.md docs/notes.md")
=> null

await nudge("git mv store/a store/b", "PostToolUse")
=> null
```
