# Activities: Runtime Helpers

The `activities/runtime.ts` module is the bridge between an activity's
declarative shape (modes, prompts, MCP configs) and the chat layer that
actually spawns Claude. Everything here is pure framework plumbing:
resolving which mode to run in, composing the system prompt, building
the MCP config with the right env vars, and keeping per-session
bookkeeping on disk.

Activity authors don't call these directly — the framework does. But
understanding what's plumbed where helps when writing a mode's
`systemPrompt()`, `available()`, and `mcpServer()`.

See `activities-base-classes.doctest.md` first for the object model.

```ts setup
import {
  Activity,
  ActivityInstance,
  ActivityMode,
  buildModeMcpConfig,
  getAvailableModes,
  listSessions,
  pickDefaultMode,
  recordSession,
  resolveMode,
  resolveSystemPrompt,
  UnknownModeError,
  CB_ACTIVITY_NAME,
  CB_ACTIVITY_ROOT,
  CB_ACTIVITY_MODE,
} from "../src/activities/index.js";
import type { ActivityMcpConfig } from "../src/activities/index.js";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

interface PolyState { language: string | null }

class PolyglotSetup extends ActivityMode {
  systemPrompt() { return "Setup: ask for a language to learn."; }
  available() { return true; }
  mcpServer(): ActivityMcpConfig {
    return createSdkMcpServer({ name: "polyglot-setup", version: "0.1.0", tools: [] });
  }
}

class PolyglotMain extends ActivityMode {
  readonly isDefault = true;
  async systemPrompt() {
    const state = await this.instance.readJson<PolyState>("state.json");
    return `Main: you are teaching ${state.language}.`;
  }
  async available() {
    const state = await this.instance.readJson<PolyState>("state.json");
    return state.language !== null;
  }
  mcpServer(): ActivityMcpConfig {
    return createSdkMcpServer({ name: "polyglot-main", version: "0.1.0", tools: [] });
  }
}

class Polyglot extends Activity {
  readonly type = "polyglot";
  readonly metadata = {
    title: "Polyglot",
    description: "Language learning",
    iconDescription: "Globe",
    singleton: false,
  };
  readonly modes = { setup: PolyglotSetup, main: PolyglotMain };

  async seedInstance(instance: ActivityInstance) {
    await instance.writeJson("state.json", { language: null });
  }
}

async function caught(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}
```

## Resolving a mode

`resolveMode` constructs the right `ActivityMode` subclass for a given
instance. This is how the framework gets a mode object to call methods
on; activity code doesn't do this.

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });

const instance = polyglot.getInstance(polyglot.instanceRoot(box.root, "spanish"));
const setup = resolveMode({ activity: polyglot, modeName: "setup", instance });
setup instanceof ActivityMode
=> true

await setup.systemPrompt()
=> Setup: ask for a language to learn.
```

An unknown mode name raises `UnknownModeError`:

``` continue
const err = await caught(() => resolveMode({ activity: polyglot, modeName: "nope", instance }));
err instanceof UnknownModeError
=> true

err && err.message
=> Unknown mode: polyglot/nope
```

```cleanup
await box.cleanup();
```

## Availability and default mode

`getAvailableModes` runs each mode's `available()` check and returns
the ones that can be entered. `pickDefaultMode` picks an entry mode:
the first `isDefault` mode that's available, otherwise the first
available mode.

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });
const instance = polyglot.getInstance(polyglot.instanceRoot(box.root, "spanish"));
```

A freshly-created instance has `state.language = null`. Only `setup`
is available, so it's also the default — even though `main` is the one
flagged `isDefault`, it isn't available yet.

``` continue
const before = await getAvailableModes(polyglot, instance);
before.map((m) => m.name).join(",")
=> setup

await pickDefaultMode(polyglot, instance)
=> setup
```

Once `state.language` is filled in (as the setup MCP tool would do),
`main.available()` flips to true. Now both modes are available, and
the default is `main` because it's flagged `isDefault`.

``` continue
await instance.writeJson("state.json", { language: "Spanish" });
const after = await getAvailableModes(polyglot, instance);
after.map((m) => m.name).sort().join(",")
=> main,setup

await pickDefaultMode(polyglot, instance)
=> main
```

```cleanup
await box.cleanup();
```

## MCP config gets activity env vars

`buildModeMcpConfig` takes the mode's declared MCP config and adds
the in-process MCP server defined by the mode (via
`createSdkMcpServer`). Tools close over the instance directly, so no
env-var hop is needed for them.

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });
const instance = polyglot.getInstance(polyglot.instanceRoot(box.root, "spanish"));
const mode = resolveMode({ activity: polyglot, modeName: "setup", instance });

const cfg = buildModeMcpConfig({ activity: polyglot, mode, modeName: "setup", instance });
cfg !== null && cfg.name
=> polyglot-setup
```

A mode with no MCP server (the default from `ActivityMode`) gets
`null` back — the chat layer just won't pass `--mcp-config` to claude.

``` continue
class Silent extends ActivityMode {
  systemPrompt() { return ""; }
  available() { return true; }
}
const silent = new Silent(instance);
buildModeMcpConfig({ activity: polyglot, mode: silent, modeName: "silent", instance })
=> null
```

```cleanup
await box.cleanup();
```

## System prompt composition

`resolveSystemPrompt` concatenates the chat's base prompt (e.g.
`CHAT_SYSTEM_PROMPT + tzContext`) with the mode's prompt. The mode's
prompt goes last so it can override or extend the base — same append
behavior as the current chat.

Function-form `systemPrompt()` methods read state at this point;
they're called once at session start and the resolved string is held
constant for the life of the session.

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });
const instance = polyglot.getInstance(polyglot.instanceRoot(box.root, "spanish"));
await instance.writeJson("state.json", { language: "Spanish" });

const main = resolveMode({ activity: polyglot, modeName: "main", instance });
const full = await resolveSystemPrompt({ basePrompt: "BASE", mode: main });
JSON.stringify(full)
=> "BASE\n\nMain: you are teaching Spanish."
```

```cleanup
await box.cleanup();
```

## Session bookkeeping

The framework records one JSON file per session at
`.callback-box/sessions/<sessionId>.json`. `recordSession` writes the
record; `listSessions` reads them back, sorted by creation time,
optionally filtered by mode.

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });
const instanceRoot = polyglot.instanceRoot(box.root, "spanish");

await recordSession({ instanceRoot, sessionId: "sess-a", mode: "setup" });
await recordSession({ instanceRoot, sessionId: "sess-b", mode: "setup" });
await recordSession({ instanceRoot, sessionId: "sess-c", mode: "main" });

const all = await listSessions({ instanceRoot });
all.map((s) => s.sessionId).sort().join(",")
=> sess-a,sess-b,sess-c

const setupOnly = await listSessions({ instanceRoot, modeName: "setup" });
setupOnly.map((s) => s.sessionId).sort().join(",")
=> sess-a,sess-b

const mainOnly = await listSessions({ instanceRoot, modeName: "main" });
mainOnly.map((s) => s.sessionId).join(",")
=> sess-c
```

Listing sessions on an instance with none returns an empty array, not
an error:

``` continue
const empty = await makeTmpBox();
const result = await listSessions({ instanceRoot: empty.path("nonexistent") });
result.length
=> 0
```

```cleanup
await box.cleanup();
await empty.cleanup();
```

## Composing everything into chat-session options

`buildActivityChatSessionOptions` is the one entry point the chat layer
calls when opening a chat session bound to `(activity, mode, instance)`.
It composes everything above into a plain options bag — no subprocesses
spawned, no I/O except reading state for the system prompt.

This is the contract between the activities module and the chat layer:
the chat layer accepts this options shape and honors each field. Keeping
the composition here means `ChatSession` stays unaware of activity
internals.

```ts setup
import { buildActivityChatSessionOptions } from "../src/activities/index.js";
```

```
const box = await makeTmpBox();
const polyglot = new Polyglot();
await polyglot.createInstance({ boxRoot: box.root, name: "spanish", displayName: "Spanish" });
const instance = polyglot.getInstance(polyglot.instanceRoot(box.root, "spanish"));
await instance.writeJson("state.json", { language: "Spanish" });

const opts = await buildActivityChatSessionOptions({
  activity: polyglot,
  modeName: "main",
  instance,
  boxRoot: box.root,
  basePrompt: "BASE",
});
```

The resolved system prompt combines base + mode:

``` continue
JSON.stringify(opts.systemPrompt)
=> "BASE\n\nMain: you are teaching Spanish."
```

The MCP config is an in-process SDK server — the chat layer hands the
config (including its instance) directly to the SDK, which then loads
the tools without spawning a subprocess. We just check the name here:

``` continue
opts.mcpConfig !== null && opts.mcpConfig.name
=> polyglot-main
```

The session-file path is relative to `boxRoot` — the chat layer stores
a single "current session id" pointer here so the user can resume the
conversation when they reopen this mode.

``` continue
opts.sessionFile
=> store/activities/polyglot/spanish/.callback-box/current-session-main.json
```

`extraEnv` is for the Claude subprocess itself (not the MCP
subprocess), so bash tools the agent uses see the activity context:

``` continue
opts.extraEnv[CB_ACTIVITY_NAME]
=> polyglot

opts.extraEnv[CB_ACTIVITY_ROOT] === instance.root
=> true

opts.extraEnv[CB_ACTIVITY_MODE]
=> main
```

`onSessionIdAssigned` writes a per-session bookkeeping record (so
`listSessions` can enumerate the transcript history):

``` continue
await opts.onSessionIdAssigned("sess-xyz");
const recorded = await listSessions({ instanceRoot: instance.root, modeName: "main" });
recorded.length
=> 1

recorded[0].sessionId
=> sess-xyz
```

```cleanup
await box.cleanup();
```

## Notes for agents

- The framework calls these helpers when opening or switching modes.
  Activity code doesn't need to import them.
- `buildModeMcpConfig` is where MCP server config gets its activity
  context. If you write an MCP tool that needs to know which instance
  it's running for, read `process.env.CB_ACTIVITY_ROOT`. See
  `src/activities/runtime.ts` for the three env var names as exported
  constants.
- `recordSession` is called by the chat layer once Claude assigns a
  session ID (from the stream-json `session_id` field). Mode switches
  close the current session and open a new one — each gets its own
  record.
- `pickDefaultMode` is how the framework decides which mode to open
  when a user navigates to an instance without specifying one.
