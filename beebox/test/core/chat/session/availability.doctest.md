# Transcript state — expired, elsewhere, or never recorded

A chat's transcript lives in one engine store on one machine and expires there,
so "the transcript isn't here" has three different meanings. The husk's
`origin` field is the only durable record of which one applies
(`docs/implemented-plans/chat-session-identity.md`, Track 3): compared against this
machine's id, it separates *this machine's chat whose transcript aged out* from
*a chat that ran somewhere else*, and its absence is reported as `unknown`
rather than guessed at.

```ts setup
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { deriveTranscriptState, resolveSessionAvailability } from "../../../../src/core/chat/session/availability.js";
import { localOrigin } from "../../../../src/core/chat/session/origin.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat.js";
import { plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { recordSessionStart } from "../../../../src/core/chat/session/session-start-record.js";
import { clearBoxConfigCache } from "../../../../src/core/box/config.js";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

async function configure(boxRoot, config) {
  await fs.mkdir(path.join(boxRoot, "_config"), { recursive: true });
  await fs.writeFile(path.join(boxRoot, "_config/box.json"), JSON.stringify(config));
  clearBoxConfigCache(boxRoot);
}

/** The husk fields the derivation reads; the rest of the card is irrelevant. */
function husk(fields) {
  return { path: "_content/chat/web/2026-08-26_aaaaaaaa.chat.card", session: "s", ...fields };
}
```

## A readable transcript is `present`, whoever's it is

```ts
const box = await makeTmpBox();
process.env["BBX_ORIGIN_ID_FILE"] = box.path("origin-id");
const here = (await localOrigin()).id;

JSON.stringify(await deriveTranscriptState({ husk: husk({ origin: "some-other-machine" }), present: true }))
=> {"state":"present"}
```

## This machine's own chat, with no transcript left, is `expired`

```ts continue
JSON.stringify(await deriveTranscriptState({ husk: husk({ origin: here, originName: "this-laptop" }), present: false }))
=> {"state":"expired"}
```

## Another machine's chat is `elsewhere`, named by its label

The hostname is a label written when the husk was stamped, and a machine can be
renamed after the fact — so when the husk carries none, the id itself stands in
rather than the row going nameless.

```ts continue
JSON.stringify(await deriveTranscriptState({ husk: husk({ origin: "prod-machine-id", originName: "prod" }), present: false }))
=> {"state":"elsewhere","originName":"prod"}

JSON.stringify(await deriveTranscriptState({ husk: husk({ origin: "prod-machine-id" }), present: false }))
=> {"state":"elsewhere","originName":"prod-machine-id"}
```

## No recorded origin — and no husk at all — is `unknown`

A husk written before the provenance fields existed says nothing about where it
ran, and calling that `expired` would report another machine's live chat as
this machine's dead one. Reconcile backfills `origin`, so the state decays.

```ts continue
JSON.stringify(await deriveTranscriptState({ husk: husk({}), present: false }))
=> {"state":"unknown"}

JSON.stringify(await deriveTranscriptState({ husk: null, present: false }))
=> {"state":"unknown"}
```

```ts continue cleanup
delete process.env["BBX_ORIGIN_ID_FILE"];
await box.cleanup();
```

## An id the box has no record of asks no engine about it

`resolveSessionAvailability` needs to know which store holds a transcript, and
for an id with no husk stamp, no history row and no reservation there is no such
store — the id is one this box has no record of. It used to take the box default
as the answer anyway, so on a codex-default box it asked Codex whether it held a
thread for an id Codex had never seen; a clean "no transcript here" then hinged
on Codex's error WORDING matching `isNotFound`, and an unrecognized phrasing
surfaced the raw RPC error on a live chat (2026-09-03, after a `git reset --hard`
rewound the box's chat registry and husk card).

The unrecorded id now resolves from the local transcript file alone. The box
default here is `codex`, and the Codex binary is pointed at a path that does not
exist — so this asserts that no engine is asked at all, not merely that the
answer comes out right. A version that guessed the default fails this outright
rather than agreeing by coincidence, which is what it did while the assertion was
only about the returned value: the real Codex replies "thread not found" for an
unknown id on a developer machine, so the guess produced the same answer and hid
the difference.

```ts
const noRecordBox = await makeTmpBox();
await configure(noRecordBox.root, { agentEngine: "codex", engines: { claude: true, codex: true } });
process.env["BBX_ORIGIN_ID_FILE"] = noRecordBox.path("origin-id");
process.env["BBX_CLAUDE_PROJECTS_DIR"] = noRecordBox.path("claude-projects");
process.env["BBX_CODEX_BINARY"] = noRecordBox.path("no-such-codex-binary");
const registry = new ChatSessionRegistry(noRecordBox.root);

const availability = await resolveSessionAvailability({
  boxRoot: noRecordBox.root,
  sessionId: randomUUID(),
  registry,
});
JSON.stringify(availability)
=> {"kind":"unavailable","reason":"missing-local-transcript","transcript":{"state":"unknown"},"huskPath":null}
```

`unknown` is the state the chat surfaces already render as "this conversation has
no saved transcript in this box" — so a session with no record says it has no
record, instead of reporting a failure of whichever engine got guessed.

```ts continue cleanup
delete process.env["BBX_ORIGIN_ID_FILE"];
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
delete process.env["BBX_CODEX_BINARY"];
await noRecordBox.cleanup();
```

## Registry presence is not evidence of a conversation

`resolveSessionAvailability` answers `resumable` early for a chat that is
mid-turn, before its transcript exists on disk. That gate used to accept mere
registry presence — and `getOrCreate` builds a session object for ANY id, so a
control mutation on an id the box had no record of registered it, and the gate
then vouched for it ahead of every check that would have caught the ghost. A
session object that has never run is not a conversation.

A merely-materialized id is a ghost, and says so:

```ts
const ghostBox = await makeTmpBox();
process.env["BBX_ORIGIN_ID_FILE"] = ghostBox.path("origin-id");
process.env["BBX_CLAUDE_PROJECTS_DIR"] = ghostBox.path("claude-projects");
const backend = createFakeChatBackend();
const ghostRegistry = new ChatSessionRegistry(ghostBox.root, {
  backend,
  buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
});

const ghost = randomUUID();
ghostRegistry.getOrCreate(ghost);
const asGhost = await resolveSessionAvailability({ boxRoot: ghostBox.root, sessionId: ghost, registry: ghostRegistry });
print(`materialized only: ${asGhost.kind}`);
=>
materialized only: unavailable
```

A session that is actually running is resumable, transcript or not — which is
the case the gate exists for:

```ts continue
const live = randomUUID();
const liveSession = ghostRegistry.getOrCreate(live);
await liveSession.send("hi");
const asLive = await resolveSessionAvailability({ boxRoot: ghostBox.root, sessionId: live, registry: ghostRegistry });
print(`running: ${asLive.kind} (isRunning=${String(liveSession.isRunning())})`);
=>
running: resumable (isRunning=true)
```

And the case tightening this gate could have broken: a real session that has
been EVICTED — its subprocess stopped to free a slot, its entry kept because it
resumes on the next send. It is neither running nor busy, so it no longer
passes this gate; it stays resumable because it has a transcript, which is what
the checks below the gate read. Nothing durable was riding on the gate alone.

```ts continue
const evicted = randomUUID();
await recordSessionStart(ghostBox.root, { sessionId: evicted, engine: "claude" });
const logPath = getSessionLogPath(ghostBox.root, evicted);
await fs.mkdir(path.dirname(logPath), { recursive: true });
await fs.writeFile(logPath, "");
const evictedSession = ghostRegistry.getOrCreate(evicted);
const asEvicted = await resolveSessionAvailability({ boxRoot: ghostBox.root, sessionId: evicted, registry: ghostRegistry });
print(`evicted with transcript: ${asEvicted.kind} (isRunning=${String(evictedSession.isRunning())})`);
=>
evicted with transcript: resumable (isRunning=false)
```

```ts continue cleanup
delete process.env["BBX_ORIGIN_ID_FILE"];
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
await ghostRegistry.shutdown();
await ghostBox.cleanup();
```
