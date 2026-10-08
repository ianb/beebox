# Chat session deletion

Deletion severs beebox resume pointers before removing SDK storage, then
permanently deletes the owned husk card. The SDK deletion function is
injected here so the fixture never touches the developer's real Claude data.

```ts setup
import { access, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deleteChatSession } from "../../../../src/core/chat/session/delete/apply/core.js";
import { encodeProjectDir } from "../../../../src/core/chat/session/transcript-paths.js";
import { appendHistory, getMostActive, loadHistory, setMostActive } from "../../../../src/core/chat/session/history.js";
import { emptyReviewState, emptySessionState, loadReviewState, saveReviewState } from "../../../../src/core/chat/review/state.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { ChatScheduleManager } from "../../../../src/core/chat/schedules/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";

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

/**
 * A box holding one chat session: its card, optionally its SDK transcript
 * (under a per-box projects dir the env var points at) and a history entry,
 * plus a registry and schedule manager to hand to `deleteChatSession`.
 * `digit` makes the session id and card name unique per example.
 */
async function chatFixture(opts: {
  digit: string;
  git?: boolean;
  title?: string;
  transcript?: boolean;
  history?: false | { contextDir?: string };
}) {
  const d = opts.digit;
  const box = await makeTmpBox(opts.git ? { git: true } : {});
  const sessionId = `${d.repeat(8)}-${d.repeat(4)}-4${d.repeat(3)}-8${d.repeat(3)}-${d.repeat(12)}`;
  const cardPath = `_content/chat/web/2026-08-07_${d.repeat(8)}.chat.card`;
  const oldProjectsRoot = process.env.BBX_CLAUDE_PROJECTS_DIR;
  const projectsRoot = join(box.root, "claude-projects");
  const projectDir = join(projectsRoot, encodeProjectDir(await realpath(box.root)));
  const jsonl = join(projectDir, `${sessionId}.jsonl`);
  if (opts.transcript) {
    process.env.BBX_CLAUDE_PROJECTS_DIR = projectsRoot;
    await mkdir(projectDir, { recursive: true });
    await writeFile(jsonl, "{}\n");
  }
  const titleLine = opts.title ? `title: ${opts.title}\n` : "";
  await box.write(cardPath, `---\ntype: chat\nsession: ${sessionId}\n${titleLine}---\n`);
  if (opts.history !== false && opts.history !== undefined) await appendHistory(box.root, { sessionId, ...opts.history });
  const registry = new ChatSessionRegistry(box.root, { backend: createFakeChatBackend() });
  const scheduleManager = new ChatScheduleManager(box.root, { onFire: () => {} });
  return {
    box, sessionId, cardPath, projectDir, jsonl, registry, scheduleManager,
    runtime: { registry, scheduleManager },
    /** Stops the managers, restores the projects env var, removes the box. */
    async cleanup() {
      scheduleManager.stopAll();
      registry.shutdown();
      if (oldProjectsRoot === undefined) delete process.env.BBX_CLAUDE_PROJECTS_DIR;
      else process.env.BBX_CLAUDE_PROJECTS_DIR = oldProjectsRoot;
      await box.cleanup();
    },
  };
}
```

## Full ordered delete

```ts
const fx = await chatFixture({ digit: "1", git: true, title: "Junk chat", transcript: true, history: {} });
const { box, sessionId, projectDir, jsonl, registry, scheduleManager } = fx;
const sidecar = join(projectDir, sessionId);
await mkdir(sidecar, { recursive: true });
await writeFile(join(sidecar, "subagent.jsonl"), "{}\n");
await setMostActive(box.root, sessionId);
const review = emptyReviewState();
review.sessions[sessionId] = emptySessionState();
await saveReviewState(box.root, review);
box.commitAll("seed chat");

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

All resumable state and the chat card are gone from the working tree:

```ts continue
JSON.stringify({
  transcript: await missing(jsonl),
  sidecar: await missing(sidecar),
  history: await loadHistory(box.root),
  active: await getMostActive(box.root),
  review: Object.keys((await loadReviewState(box.root)).sessions),
  schedules: scheduleManager.getActive().length,
  card: await missing(join(box.root, fx.cardPath)),
  trash: await box.list("_bookkeeping/trash"),
})
=> {"transcript":true,"sidecar":true,"history":[],"active":null,"review":[],"schedules":0,"card":true,"trash":"_bookkeeping/trash/.gitkeep"}
```

```ts cleanup
await fx.cleanup();
```

## Malformed callback state aborts before deletion

```ts
const fx = await chatFixture({ digit: "6" });
const { box, sessionId, registry } = fx;
await box.write(".beebox/chat-session-history.json", "{broken");
const errorName = await deletionErrorName({ boxRoot: box.root, sessionId, runtime: fx.runtime });
JSON.stringify({ errorName, blocked: registry.deletion.isBlocked(sessionId), huskMissing: await missing(join(box.root, fx.cardPath)) })
=> {"errorName":"SyntaxError","blocked":false,"huskMissing":false}
```

```ts cleanup
await fx.cleanup();
```

## Context disagreement aborts before mutation

The editable husk and the history index must name the same SDK cwd. A mismatch
cannot be treated as an already-absent transcript.

```ts
const fx = await chatFixture({ digit: "3", history: { contextDir: "_content/landmark" } });
const { box, sessionId } = fx;
await box.write("_content/landmark/.keep", "");
const errorName = await deletionErrorName({ boxRoot: box.root, sessionId, runtime: fx.runtime });
JSON.stringify({ errorName, history: await loadHistory(box.root), huskMissing: await missing(join(box.root, fx.cardPath)) })
=> {"errorName":"SessionStorageContextMismatchError","history":["33333333-3333-4333-8333-333333333333"],"huskMissing":false}
```

```ts cleanup
await fx.cleanup();
```

## A failed delete commit can be retried after restart

If the git commit fails after permanent storage deletion, a fresh registry can
finish cleanup after the permanent card deletion.

```ts
const fx = await chatFixture({ digit: "4", git: true, transcript: true, history: {} });
const { box, sessionId, projectDir, registry, scheduleManager } = fx;
await box.commitAll("seed retry chat");
const first = await deleteChatSession({
  boxRoot: box.root,
  sessionId,
  runtime: fx.runtime,
  sdkDelete: async (id) => rm(join(projectDir, `${id}.jsonl`), { force: true }),
  commitHusks: async () => { throw new Error("fixture commit failure"); },
});
registry.shutdown();
const restartedRegistry = new ChatSessionRegistry(box.root, { backend: createFakeChatBackend() });
const second = await deleteChatSession({ boxRoot: box.root, sessionId, runtime: { registry: restartedRegistry, scheduleManager } });
JSON.stringify({ first, second, cardGone: await missing(join(box.root, fx.cardPath)), latest: await import("simple-git").then(async ({ simpleGit }) => (await simpleGit(box.root).log()).latest?.message), trash: await box.list("_bookkeeping/trash") })
=> {"first":{"status":"cleanup-required","sessionId":"44444444-4444-4444-8444-444444444444","storage":"absent","retry":"delete-husk"},"second":{"status":"deleted","sessionId":"44444444-4444-4444-8444-444444444444","schedulesCancelled":0},"cardGone":true,"latest":"Delete chat conversation","trash":"_bookkeeping/trash/.gitkeep"}
```

```ts cleanup
restartedRegistry.shutdown();
await fx.cleanup();
```

## An uncommitted chat card is deleted without a commit

```ts
const fx = await chatFixture({ digit: "5", git: true, transcript: true, history: {} });
const { box, sessionId, projectDir } = fx;
const result = await deleteChatSession({ boxRoot: box.root, sessionId, runtime: fx.runtime, sdkDelete: async (id) => rm(join(projectDir, `${id}.jsonl`), { force: true }) });
JSON.stringify({ result, cardGone: await missing(join(box.root, fx.cardPath)), commit: await import("simple-git").then(({ simpleGit }) => simpleGit(box.root).log().then((log) => log.total)) })
=> {"result":{"status":"deleted","sessionId":"55555555-5555-4555-8555-555555555555","schedulesCancelled":0},"cardGone":true,"commit":1}
```

```ts cleanup
await fx.cleanup();
```

## SDK no-change failure restores beebox state

```ts
const fx = await chatFixture({ digit: "2", transcript: true, history: {} });
const { box, sessionId, jsonl, registry, scheduleManager } = fx;
await setMostActive(box.root, sessionId);
const review = emptyReviewState();
review.sessions[sessionId] = emptySessionState();
await saveReviewState(box.root, review);
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
await fx.cleanup();
```
