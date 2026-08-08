# Chat session deletion

Deletion severs callback-box resume pointers before removing SDK storage, then
moves the owned husk card to git-tracked Trash. The SDK deletion function is
injected here so the fixture never touches the developer's real Claude data.

```ts setup
import { access, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deleteChatSession } from "../../src/core/chat/session/delete.js";
import { encodeProjectDir } from "../../src/core/chat/session/transcript-paths.js";
import { appendHistory, getMostActive, loadHistory, setMostActive } from "../../src/core/chat/session/history.js";
import { emptyReviewState, emptySessionState, loadReviewState, saveReviewState } from "../../src/core/chat/review/state.js";
import { ChatSessionRegistry } from "../../src/core/chat/session/registry.js";
import { ChatScheduleManager } from "../../src/core/chat/schedules.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function missing(target: string): Promise<boolean> {
  try { await access(target); return false; } catch { return true; }
}

async function deletionErrorName(options: Parameters<typeof deleteChatSession>[0]): Promise<string> {
  try {
    await deleteChatSession(options);
    return "no error";
  } catch (error) {
    return error instanceof Error ? error.name : "unknown";
  }
}
```

## Full ordered delete

```ts
const box = await makeTmpBox({ git: true });
const sessionId = "11111111-1111-4111-8111-111111111111";
const oldProjectsRoot = process.env.CB_CLAUDE_PROJECTS_DIR;
const projectsRoot = join(box.packageRoot, "claude-projects");
process.env.CB_CLAUDE_PROJECTS_DIR = projectsRoot;
const cwd = await realpath(box.root);
const projectDir = join(projectsRoot, encodeProjectDir(cwd));
const jsonl = join(projectDir, `${sessionId}.jsonl`);
const sidecar = join(projectDir, sessionId);
await mkdir(sidecar, { recursive: true });
await writeFile(jsonl, "{}\n");
await writeFile(join(sidecar, "subagent.jsonl"), "{}\n");
await box.write("store/chat/web/2026-08-07_11111111.chat.card", `---\ntype: chat\nsession: ${sessionId}\ntitle: Junk chat\n---\n`);
await appendHistory(box.root, { sessionId });
await setMostActive(box.root, sessionId);
const review = emptyReviewState();
review.sessions[sessionId] = emptySessionState();
await saveReviewState(box.root, review);
box.commitAll("seed chat");

const registry = new ChatSessionRegistry(box.root, { backend: createFakeChatBackend() });
const scheduleManager = new ChatScheduleManager(box.root, { onFire: () => {} });
scheduleManager.addSchedule({
  label: "linked", alarm: false, announce: null, content: "later",
  durationMs: 60_000, sessionId,
});
const result = await deleteChatSession({
  boxRoot: box.root,
  sessionId,
  runtime: { registry, scheduleManager, maintenance: Promise.resolve() },
  sdkDelete: async (id) => {
    await rm(join(projectDir, `${id}.jsonl`), { force: true });
    await rm(join(projectDir, id), { recursive: true, force: true });
  },
});
JSON.stringify(result)
=> {"status":"deleted","sessionId":"11111111-1111-4111-8111-111111111111","schedulesCancelled":1}
```

All resumable state is gone, while the card is recoverable from Trash:

```ts continue
JSON.stringify({
  transcript: await missing(jsonl),
  sidecar: await missing(sidecar),
  history: await loadHistory(box.root),
  active: await getMostActive(box.root),
  review: Object.keys((await loadReviewState(box.root)).sessions),
  schedules: scheduleManager.getActive().length,
  trash: await box.list("store/trash"),
})
=> {"transcript":true,"sidecar":true,"history":[],"active":null,"review":[],"schedules":0,"trash":"store/trash/2026-08-07_11111111.chat.card"}
```

```ts cleanup
scheduleManager.stopAll();
registry.shutdown();
if (oldProjectsRoot === undefined) delete process.env.CB_CLAUDE_PROJECTS_DIR;
else process.env.CB_CLAUDE_PROJECTS_DIR = oldProjectsRoot;
await box.cleanup();
```

## Malformed callback state aborts before deletion

```ts
const box = await makeTmpBox();
const sessionId = "66666666-6666-4666-8666-666666666666";
await box.write("store/chat/web/2026-08-07_66666666.chat.card", `---\ntype: chat\nsession: ${sessionId}\n---\n`);
await box.write(".callback-box/chat-session-history.json", "{broken");
const registry = new ChatSessionRegistry(box.root, { backend: createFakeChatBackend() });
const scheduleManager = new ChatScheduleManager(box.root, { onFire: () => {} });
const errorName = await deletionErrorName({ boxRoot: box.root, sessionId, runtime: { registry, scheduleManager } });
JSON.stringify({ errorName, blocked: registry.deletion.isBlocked(sessionId), huskMissing: await missing(join(box.root, "store/chat/web/2026-08-07_66666666.chat.card")) })
=> {"errorName":"SyntaxError","blocked":false,"huskMissing":false}
```

```ts cleanup
scheduleManager.stopAll();
registry.shutdown();
await box.cleanup();
```

## Context disagreement aborts before mutation

The editable husk and the history index must name the same SDK cwd. A mismatch
cannot be treated as an already-absent transcript.

```ts
const box = await makeTmpBox();
const sessionId = "33333333-3333-4333-8333-333333333333";
await box.write("store/landmark/.keep", "");
await box.write("store/chat/web/2026-08-07_33333333.chat.card", `---\ntype: chat\nsession: ${sessionId}\n---\n`);
await appendHistory(box.root, { sessionId, contextDir: "store/landmark" });
const registry = new ChatSessionRegistry(box.root, { backend: createFakeChatBackend() });
const scheduleManager = new ChatScheduleManager(box.root, { onFire: () => {} });
const errorName = await deletionErrorName({ boxRoot: box.root, sessionId, runtime: { registry, scheduleManager } });
JSON.stringify({ errorName, history: await loadHistory(box.root), huskMissing: await missing(join(box.root, "store/chat/web/2026-08-07_33333333.chat.card")) })
=> {"errorName":"SessionStorageContextMismatchError","history":["33333333-3333-4333-8333-333333333333"],"huskMissing":false}
```

```ts cleanup
scheduleManager.stopAll();
registry.shutdown();
await box.cleanup();
```

## Retry after restart commits an already-moved husk

If the git commit fails after permanent storage deletion, a fresh registry can
reconstruct the rename from git status and finish it.

```ts
const box = await makeTmpBox({ git: true });
const sessionId = "44444444-4444-4444-8444-444444444444";
const oldProjectsRoot = process.env.CB_CLAUDE_PROJECTS_DIR;
const projectsRoot = join(box.packageRoot, "claude-projects");
process.env.CB_CLAUDE_PROJECTS_DIR = projectsRoot;
const projectDir = join(projectsRoot, encodeProjectDir(await realpath(box.root)));
await mkdir(projectDir, { recursive: true });
await writeFile(join(projectDir, `${sessionId}.jsonl`), "{}\n");
await box.write("store/chat/web/2026-08-07_44444444.chat.card", `---\ntype: chat\nsession: ${sessionId}\n---\n`);
await appendHistory(box.root, { sessionId });
await box.commitAll("seed retry chat");
const registry = new ChatSessionRegistry(box.root, { backend: createFakeChatBackend() });
const scheduleManager = new ChatScheduleManager(box.root, { onFire: () => {} });
const first = await deleteChatSession({
  boxRoot: box.root,
  sessionId,
  runtime: { registry, scheduleManager },
  sdkDelete: async (id) => rm(join(projectDir, `${id}.jsonl`), { force: true }),
  commitTrash: async () => { throw new Error("fixture commit failure"); },
});
registry.shutdown();
const restartedRegistry = new ChatSessionRegistry(box.root, { backend: createFakeChatBackend() });
const second = await deleteChatSession({ boxRoot: box.root, sessionId, runtime: { registry: restartedRegistry, scheduleManager } });
JSON.stringify({ first, second })
=> {"first":{"status":"cleanup-required","sessionId":"44444444-4444-4444-8444-444444444444","storage":"absent","retry":"commit-trash","huskTrashed":true,"commitPending":true},"second":{"status":"deleted","sessionId":"44444444-4444-4444-8444-444444444444","schedulesCancelled":0}}
```

```ts cleanup
scheduleManager.stopAll();
restartedRegistry.shutdown();
if (oldProjectsRoot === undefined) delete process.env.CB_CLAUDE_PROJECTS_DIR;
else process.env.CB_CLAUDE_PROJECTS_DIR = oldProjectsRoot;
await box.cleanup();
```

## SDK no-change failure restores callback-box state

```ts
const box = await makeTmpBox();
const sessionId = "22222222-2222-4222-8222-222222222222";
const oldProjectsRoot = process.env.CB_CLAUDE_PROJECTS_DIR;
const projectsRoot = join(box.packageRoot, "claude-projects");
process.env.CB_CLAUDE_PROJECTS_DIR = projectsRoot;
const projectDir = join(projectsRoot, encodeProjectDir(await realpath(box.root)));
const jsonl = join(projectDir, `${sessionId}.jsonl`);
await mkdir(projectDir, { recursive: true });
await writeFile(jsonl, "{}\n");
await box.write("store/chat/web/2026-08-07_22222222.chat.card", `---\ntype: chat\nsession: ${sessionId}\n---\n`);
await appendHistory(box.root, { sessionId });
await setMostActive(box.root, sessionId);
const review = emptyReviewState();
review.sessions[sessionId] = emptySessionState();
await saveReviewState(box.root, review);
const registry = new ChatSessionRegistry(box.root, { backend: createFakeChatBackend() });
const scheduleManager = new ChatScheduleManager(box.root, { onFire: () => {} });
scheduleManager.addSchedule({
  label: "restore-me", alarm: false, announce: null, content: "later",
  durationMs: 60_000, sessionId,
});
await deletionErrorName({
  boxRoot: box.root,
  sessionId,
  runtime: { registry, scheduleManager, maintenance: Promise.resolve() },
  sdkDelete: async () => { throw new TypeError("fixture SDK failure"); },
})
=> TypeError
```

```ts continue
JSON.stringify({
  transcriptPresent: !(await missing(jsonl)),
  history: await loadHistory(box.root),
  active: await getMostActive(box.root),
  reviewed: Object.keys((await loadReviewState(box.root)).sessions),
  schedules: scheduleManager.getActive().map((schedule) => schedule.label),
  blocked: registry.deletion.isBlocked(sessionId),
})
=> {"transcriptPresent":true,"history":["22222222-2222-4222-8222-222222222222"],"active":"22222222-2222-4222-8222-222222222222","reviewed":["22222222-2222-4222-8222-222222222222"],"schedules":["restore-me"],"blocked":false}
```

```ts cleanup
scheduleManager.stopAll();
registry.shutdown();
if (oldProjectsRoot === undefined) delete process.env.CB_CLAUDE_PROJECTS_DIR;
else process.env.CB_CLAUDE_PROJECTS_DIR = oldProjectsRoot;
await box.cleanup();
```
