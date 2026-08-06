# Transcript rendering: entries, elision, and the composed form

`src/core/chat/transcript-render.ts` renders a transcript for a model. Rendering
and elision are separate functions because the two consumers need different
things: the retrospective observer wants the capped one-shot form, while chat
review must measure how much *new* material a span holds — which the capped form
cannot express, since its length stops growing at the cap.

```ts setup
import {
  elideMiddle,
  MAX_RENDERED_CHARS,
  renderEntries,
  renderSessionCompact,
} from "../../../src/core/chat/transcript-render.js";
import { MAX_SESSION_ENTRIES } from "../../../src/cli/lib/session.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../src/core/chat/session/transcript-paths.js";

function userEntry(uuid: string, text: string) {
  return {
    uuid,
    type: "user" as const,
    timestamp: "2026-07-28T03:00:00Z",
    content: [{ type: "text" as const, text }],
  };
}

function agentEntry(uuid: string, text: string) {
  return {
    uuid,
    type: "assistant" as const,
    timestamp: "2026-07-28T03:00:01Z",
    content: [{ type: "text" as const, text }],
  };
}

async function captureWarnings(action: () => Promise<void>): Promise<string[]> {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    await action();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}
```

## Dialogue renders with role headers, joined by a rule

```ts
renderEntries([userEntry("u1", "Can you check the invoice?"), agentEntry("a1", "Checked — it's paid.")])
=>
**User** (2026-07-28T03:00:00Z)
Can you check the invoice?
«blankline»
---
«blankline»
**Agent** (2026-07-28T03:00:01Z)
Checked — it's paid.
```

Speech wrappers are stripped from user text so a reader quotes clean words, and
an entry whose visible content is only its role header drops out entirely.

```ts continue
renderEntries([userEntry("u2", "<typed user=\"Ian\">plain words</typed>"), userEntry("u3", "")])
=>
**User** (2026-07-28T03:00:00Z)
plain words
```

## `renderEntries` is uncapped — that is the point

`spanSize` gates on this, so it must keep growing past the elision cap.

```ts
const many = Array.from({ length: 400 }, (_, i) => userEntry(`u${i}`, "y".repeat(200)));
const rendered = renderEntries(many);
rendered.length > MAX_RENDERED_CHARS * 2
=> true

// No elision marker — nothing was dropped.
rendered.includes("chars of conversation elided")
=> false
```

## `elideMiddle` keeps both ends

Corrections and decisions show up at the start and end of long conversations, so
the middle is what goes.

```ts
elideMiddle("abcdefghij", 100)
=> abcdefghij

const elided = elideMiddle("x".repeat(50) + "MIDDLE" + "y".repeat(50), 20);
elided.startsWith("xxxxxxxxxx")
=> true

elided.endsWith("yyyyyyyyyy")
=> true

elided.includes("MIDDLE")
=> false

elided.includes("(86 chars of conversation elided)")
=> true
```

## `renderSessionCompact` is exactly the composition of the two

This is the regression anchor for the retrospective observer, whose behaviour
must not have changed when the module was split. Under the cap, the composed
form equals the raw render; over it, it equals the elided render.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

async function seed(sessionId: string, entries: object[]) {
  const logPath = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return logPath;
}

function raw(uuid: string, text: string) {
  return { type: "user", uuid, timestamp: "2026-07-28T03:00:00Z", message: { role: "user", content: [{ type: "text", text }] } };
}

const shortPath = await seed("short", [raw("u1", "hello"), raw("u2", "again")]);
let shortOut = "";
const shortWarnings = await captureWarnings(async () => { shortOut = await renderSessionCompact(shortPath); });
shortOut === elideMiddle(shortOut, MAX_RENDERED_CHARS)
=> true

shortOut.includes("elided")
=> false

shortWarnings.length
=> 0
```

```ts continue
const bigPath = await seed("big", Array.from({ length: 400 }, (_, i) => raw(`u${i}`, "z".repeat(200))));
const bigOut = await renderSessionCompact(bigPath);

// Clamped — this is why the size gate cannot use it.
bigOut.length <= MAX_RENDERED_CHARS + 100
=> true

bigOut.includes("chars of conversation elided")
=> true
```

An entry-count cap is a separate limit from character elision. A transcript
past that cap still renders the same first page, but it now announces the
degradation instead of silently hiding the later entries.

```ts continue
const overCapPath = await seed(
  "over-cap",
  Array.from({ length: MAX_SESSION_ENTRIES + 1 }, (_, i) => raw(`cap-${i}`, "x")),
);
const capWarnings = await captureWarnings(async () => { await renderSessionCompact(overCapPath); });
capWarnings.length
=> 1

capWarnings[0]?.includes(`has ${String(MAX_SESSION_ENTRIES + 1)} entries; rendering the first ${String(MAX_SESSION_ENTRIES)}.`)
=> true
```

```ts cleanup
await box.cleanup();
```
