# Agent session id plumbing

Tests for `createAgent`'s session-id handling (`src/core/agent.ts` →
`src/core/agent-run.ts`). The chat reactor pre-mints a session id
(`chat-reactor-sessions.ts`) and stores it in
`.callback-box/chat-sessions.json`; for that stored id to be resumable in a
later reactor cycle, the *first* run must hand it to the SDK as the
create-with-id `sessionId` option. This was silently dropped in the
2026-05 SDK migration (the minted id never reached the SDK, so every
resume failed with "No conversation found"); these tests pin the plumbing.

The dry-run path reports the session id the run would use, which lets us
assert the plumbing without spawning the SDK.

```ts setup
import { createAgent } from "../../src/core/agent.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const MINTED = "11111111-1111-4111-8111-111111111111";
```

## Pre-minted id reaches the first (fresh) run as create-with-id

```ts
const box = await makeTmpBox();
const agent = createAgent({ name: "test", sessionId: MINTED });

const first = await agent.invoke({ boxRoot: box.root, prompt: "hi", dryRun: true });
first.sessionId === MINTED
=> true
```

The second invoke on the same agent resumes that same id:

```ts continue
const second = await agent.invoke({ boxRoot: box.root, prompt: "again", dryRun: true });
second.sessionId === MINTED
=> true

await box.cleanup();
```

## resume: true resumes the given id from the first invoke

```ts
const box = await makeTmpBox();
const agent = createAgent({ name: "test", sessionId: MINTED, resume: true });

const run = await agent.invoke({ boxRoot: box.root, prompt: "hi", dryRun: true });
run.sessionId === MINTED
=> true

await box.cleanup();
```

## Without a pre-minted id the SDK assigns one (unknown before the run)

```ts
const box = await makeTmpBox();
const agent = createAgent({ name: "test" });

const run = await agent.invoke({ boxRoot: box.root, prompt: "hi", dryRun: true });
run.sessionId === ""
=> true

agent.sessionId === null
=> true

await box.cleanup();
```
