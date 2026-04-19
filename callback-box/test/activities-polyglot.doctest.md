# Polyglot (built-in activity)

`Polyglot` is the first built-in activity. It's a language-learning
container with two modes:

- `setup` — always available. Agent gathers the target language and
  proficiency level from the user and advises them to write the
  values to `state.json`. State mutation from a chat tool is a
  follow-up — for now, `setup` is conversational only.
- `main` — available once `state.json` has a non-null `language`.
  Flagged `isDefault`, so it becomes the entry mode once configured.

See `src/activities/polyglot/` for the code.

```ts setup
import { Polyglot } from "../src/activities/polyglot/index.js";
import { applyPolyglotConfigure } from "../src/activities/polyglot/configure.js";
import { getAvailableModes, pickDefaultMode, resolveMode } from "../src/activities/index.js";
import type { PolyglotState } from "../src/activities/polyglot/index.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

async function caught(fn) { try { await fn(); return null; } catch (e) { return e; } }
```

## Creating an instance seeds initial state + CLAUDE.md

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish practice" });

await box.list("store/activities/polyglot/spanish")
=>
store/activities/polyglot/spanish/.callback-box
store/activities/polyglot/spanish/.callback-box/instance.json
store/activities/polyglot/spanish/CLAUDE.md
store/activities/polyglot/spanish/state.json
```

Initial state has both fields null:

``` continue
const state = JSON.parse(await box.read("store/activities/polyglot/spanish/state.json"));
JSON.stringify({ language: state.language, level: state.level })
=> {"language":null,"level":null}
```

The instance `CLAUDE.md` is rendered from a template and substitutes
the display name:

``` continue
(await box.read("store/activities/polyglot/spanish/CLAUDE.md")).startsWith("# Spanish practice")
=> true
```

```cleanup
await box.cleanup();
```

## setup is always available, main gates on state.language

A freshly-created instance only has `setup` available:

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });
const instance = polyglot.getInstance(polyglot.instanceRoot(box.root, "spanish"));

const before = await getAvailableModes(polyglot, instance);
before.map((m) => m.name).sort().join(",")
=> setup

await pickDefaultMode(polyglot, instance)
=> setup
```

Fill in `language` + `level` in state.json and `main` becomes
available. Because `main` is marked `isDefault`, it now wins as the
default entry mode — `setup` stays available as a reconfigurator.

``` continue
await instance.writeJson("state.json", { language: "Spanish", level: "beginner", createdAt: "2026-04-19T00:00:00Z" });

const after = await getAvailableModes(polyglot, instance);
after.map((m) => m.name).sort().join(",")
=> main,setup

await pickDefaultMode(polyglot, instance)
=> main
```

```cleanup
await box.cleanup();
```

## main's system prompt reads state at session start

`main.systemPrompt()` composes a prompt that names the configured
language and level. This is evaluated once at session start (the
framework resolves it via `buildActivityChatSessionOptions`).

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });
const instance = polyglot.getInstance(polyglot.instanceRoot(box.root, "spanish"));
await instance.writeJson("state.json", { language: "Spanish", level: "beginner", createdAt: "2026-04-19T00:00:00Z" });

const main = resolveMode({ activity: polyglot, modeName: "main", instance });
const prompt = await main.systemPrompt();
prompt.includes("Spanish")
=> true

prompt.includes("beginner")
=> true
```

If `language` is null (should not reach here — `available()` gates
entry), `systemPrompt` throws with a loud message:

``` continue
await instance.writeJson("state.json", { language: null, level: null, createdAt: "2026-04-19T00:00:00Z" });
const mainAgain = resolveMode({ activity: polyglot, modeName: "main", instance });
const thrown = await caught(() => mainAgain.systemPrompt());
thrown && thrown.message.includes("language not set")
=> true
```

```cleanup
await box.cleanup();
```

## setup's system prompt is the static template

`setup.systemPrompt()` reads the static markdown template in
`src/activities/polyglot/setup-prompt.md`. It doesn't depend on
instance state — any instance in setup mode sees the same prompt.

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });
const instance = polyglot.getInstance(polyglot.instanceRoot(box.root, "spanish"));

const setup = resolveMode({ activity: polyglot, modeName: "setup", instance });
const prompt = await setup.systemPrompt();
prompt.includes("language the user wants to learn")
=> true

prompt.includes("proficiency")
=> true
```

```cleanup
await box.cleanup();
```

## applyPolyglotConfigure writes state.json

`applyPolyglotConfigure` is the pure state-mutation that the setup
MCP tool calls. Tests exercise it directly — no MCP server needed.
It preserves `createdAt` across calls (so reconfiguring doesn't
fabricate a new creation time):

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });
const instanceRoot = polyglot.instanceRoot(box.root, "spanish");
const before = JSON.parse(await box.read("store/activities/polyglot/spanish/state.json"));

const after = await applyPolyglotConfigure({ instanceRoot, input: { language: "Spanish", level: "beginner" } });
after.language
=> Spanish

after.level
=> beginner

after.createdAt === before.createdAt
=> true
```

Calling again overwrites the fields but keeps `createdAt` stable:

``` continue
const second = await applyPolyglotConfigure({ instanceRoot, input: { language: "French", level: "intermediate" } });
second.language
=> French

second.createdAt === before.createdAt
=> true
```

```cleanup
await box.cleanup();
```

## setup mode declares its MCP server

`PolyglotSetupMode.mcpServer()` returns a config pointing at
`setup-mcp.ts` — the chat layer picks this up, launches it as a
subprocess with `CB_ACTIVITY_*` env vars, and claude gets access to
the `configure` tool. Main mode has no tools yet, so `mcpServer()`
returns `null` (the ActivityMode base-class default).

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });
const instance = polyglot.getInstance(polyglot.instanceRoot(box.root, "spanish"));

const setup = resolveMode({ activity: polyglot, modeName: "setup", instance });
const cfg = setup.mcpServer();
cfg !== null && cfg.command
=> tsx

cfg !== null && cfg.args[0].endsWith("setup-mcp.ts")
=> true

const main = resolveMode({ activity: polyglot, modeName: "main", instance });
main.mcpServer()
=> null
```

```cleanup
await box.cleanup();
```

## Notes for follow-ups

- `main` mode has no MCP tools yet — no flashcards, no lesson
  tracking. It's intentionally minimum: a conversational language
  tutor with the configured context. Richer behavior comes later.
- The setup MCP server is launched via `tsx`. In production that
  means `tsx` must be available on PATH in the chat subprocess env
  — already true because `ChatSession` prepends the project `bin/`
  to PATH for its own use.
- End-to-end MCP tool invocation (agent actually calls `configure`
  and state.json flips) is exercised via the manual harness at
  `test/manual/activity-chat-live.ts`, not the automated suite.
- The registered class lives in `createBuiltinRegistry()`. Listing
  activities via `cb activity list` or the tRPC `listTypes` now
  returns Polyglot as the one built-in.
