# Activities — Design Proposal

Status: proposal, for review. Not yet a spec.

## Motivation

Today the chat interface is a single coherent experience: one personality, one system prompt, one set of output tags (`<speech>`, `<schedule>`, `<self-note>`), one companion-view protocol (`view:?zoom`). That's the right default for a personal assistant.

But there are other "shapes" of chat a box owner might want: language learning, notebook, guided journaling, a CYOA, structured reflection. Each wants its own identity, its own tools, its own way of rendering responses, and its own persistent state — without forking the chat surface.

An **activity** is a reusable container for that: a module that declares one or more **modes** (each with its own system prompt, MCP tools, sidecar view, and inline-markup renderers), shared instance state, and activity-level metadata.

## Concepts

- **Activity** — a code module describing one *kind* of experience (polyglot, notebook-dungeon, reflection-journal). Activities are classes; instances are state.
- **Instance** — one running experience of that activity (e.g. "teach Ian Spanish"). Lives in its own directory under `store/activities/` and carries state files shared by all modes.
- **Mode** — one of several parallel framings an instance can be used in. Each mode has its own system prompt, MCP server, sidecar view, and inline-tag renderers. All modes of an instance share the same state files and the same activity metadata (title, icon, singleton flag). Modes are not phases in sequence — they are alternative entry points that may or may not be available at any given moment.
- **Session** — a chat session bound to a specific `(instance, mode)`. Multiple sessions per `(instance, mode)` are allowed; all sessions across all modes share the instance's state files, but each session has its own transcript.

Canonical modes:
- `setup` — configuring the instance. Usually always available; may stay available after setup as a reconfigurator.
- `main` — the typical running experience. Usually the default entry point, and usually only available once setup has populated required state.
- others by activity: `parent-review` (an adult's view of a child's learning), `journal-export`, `weekly-reflection`, etc.

## Mode availability

Mode availability is **computed dynamically from instance state** — no marker files, no flags. Each mode declares an `available(ctx)` function that inspects state and returns whether the mode can be entered.

Typical patterns:
- `setup` → always available.
- `main` → available when required parameters exist in state.
- `parent-review` → available only for viewers flagged as a parent.

The framework evaluates availability every time the mode list is needed (gallery tile, mode switcher, URL-guard). If no mode is marked default (`isDefault: true`), the framework picks the first available mode in declaration order.

There is no explicit "finalize" step. A setup-mode tool mutates state; the next check of `main.available()` returns true; `main` now shows in the mode switcher. The user (or the agent — see open questions) moves over when ready.

## Directory layout

### Built-in activities

Ship with callback-box at `src/activities/<name>/`. Available to every box. No nested `src/` — built-ins live directly in the callback-box source tree.

### Box-local activities

Live at `<box>/activities/<name>/src/`. The `src/` subdirectory is deliberate — the activity directory isn't just code, it may also hold fixtures, examples, docs, a `CLAUDE.md` for agents editing the activity, etc. Keeping the TS under `src/` avoids mixing.

Box-local overrides built-in of the same name. Same override pattern as `views/`.

### Instance directory

`<box>/store/activities/<activity-name>/<instance-name>/`

Contents are **entirely activity-defined**. The framework writes nothing here by default. Prompts and other code-like artifacts live in the activity source, not in the instance directory. Activities may lay out `state.json`, a `cards/` subdirectory, `notes.md`, or anything else that fits.

### Framework bookkeeping

Framework-owned files (instance metadata, session bookkeeping) live at:

`<box>/store/activities/<activity-name>/<instance-name>/.callback-box/`

Layout:
- `.callback-box/instance.json` — `{ displayName, createdAt, type }` written by `createInstance`.
- `.callback-box/sessions/<session-id>.json` — `{ mode, createdAt }` per session.

This directory is gitignored. Activities must not read or write here — use the helpers in `ActivityInstance` (which only touch activity-owned files) instead.

## Activity module interface

Three abstract base classes (names not final):

```ts
abstract class Activity {
  abstract readonly type: string;
  abstract readonly metadata: {
    title: string;
    description: string;
    iconDescription: string;   // alt text / a11y
    singleton: boolean;
  };
  abstract readonly Icon: LazyComponent;   // React component (SVG or image)
  abstract readonly modes: Record<string, typeof ActivityMode>;

  abstract listInstances(ctx: { boxRoot: string }): Promise<InstanceSummary[]>;
  abstract createInstance(ctx: { boxRoot: string; name: string; displayName: string }): Promise<void>;

  // framework provides default; activities can override if they want a custom ActivityInstance subclass
  getInstance(root: string): ActivityInstance;
}

abstract class ActivityInstance {
  constructor(public readonly root: string) {}

  // library helpers, usable without subclassing
  readJson<T>(file: string): Promise<T>;
  writeJson(file: string, value: unknown): Promise<void>;
  appendJsonl(file: string, entry: unknown): Promise<void>;
  readJsonl<T>(file: string): Promise<T[]>;
  // ... etc.
}

abstract class ActivityMode<I extends ActivityInstance = ActivityInstance> {
  constructor(protected readonly instance: I) {}

  abstract systemPrompt(): string | Promise<string>;
  /**
   * Returns an in-process MCP server built via the SDK's
   * `createSdkMcpServer({ name, tools })`. Tools close over `this.instance`
   * directly — no subprocess hop, no env-var passing.
   */
  abstract mcpServer(): import("@anthropic-ai/claude-agent-sdk").McpSdkServerConfigWithInstance | null;
  abstract available(): boolean | Promise<boolean>;

  readonly isDefault: boolean = false;
  readonly ui?: {
    SidecarView?: LazyComponent;
    inlineTags?: Record<string, LazyComponent>;
  };
}
```

Per-activity code then looks roughly like:

```ts
class Polyglot extends Activity {
  readonly type = "polyglot";
  readonly metadata = {
    title: "Language Learning",
    description: "Learn a language through conversation and structured practice",
    iconDescription: "A globe",
    singleton: false,
  };
  readonly Icon = lazy(() => import("./Icon"));
  readonly modes = { setup: PolyglotSetup, main: PolyglotMain };

  async listInstances({ boxRoot }) { /* … */ }
  async createInstance({ boxRoot, name, displayName }) { /* seed files, write instance CLAUDE.md */ }
}

class PolyglotMain extends ActivityMode {
  readonly isDefault = true;
  readonly ui = {
    SidecarView: lazy(() => import("./main/SidecarView")),
    inlineTags: { ADDENDUM: lazy(() => import("./main/Addendum")) },
  };
  async systemPrompt() { return compileMainPrompt(await this.instance.readJson("state.json")); }
  mcpServer() {
    return createSdkMcpServer({
      name: "polyglot-main",
      tools: [tool("noteProgress", "Save a learning note", { text: z.string() }, async ({ text }) => {
        await this.instance.appendJsonl("notes.jsonl", { text, at: new Date().toISOString() });
        return { content: [{ type: "text", text: "saved" }] };
      })],
    });
  }
  async available() { return hasRequiredState(await this.instance.readJson("state.json")); }
}
```

Notes:
- `systemPrompt` can be a static string or a method that reads state via `this.instance`. Resolved once at session start, held constant for the life of the session.
- `available` should be cheap and side-effect-free.
- `ui` is optional. A minimal mode is an `available()` check plus a `systemPrompt()` plus a `mcpServer()`.
- Lifecycle methods (`listInstances`, `createInstance`) live on `Activity` directly — not in a sub-object.
- Modes are registered as class references (`typeof ActivityMode`); the framework constructs them with the `ActivityInstance` when needed.
- A singleton activity with one mode and no tools should be expressible in ~20 lines.

## Lifecycle

1. User opens the activity gallery → picks Polyglot → clicks "new". (Equivalent CLI path: `cb activity new polyglot spanish-ian`.)
2. Framework calls `activity.createInstance({ boxRoot, name, displayName })`. Activity writes whatever bootstrap state it wants, including an instance `CLAUDE.md` (see below).
3. Framework evaluates available modes and picks the default (usually `setup` for a fresh instance).
4. Chat session starts, bound to `(instance, setup)`. System prompt = `CHAT_SYSTEM_PROMPT + resolve(modes.setup.systemPrompt)`. Setup MCP is spawned for the session.
5. Agent drives the conversation. MCP tools mutate instance state files.
6. State changes mean `main.available()` may now return true. The mode switcher surfaces `main` as selectable.
7. User switches to `main` mode (explicit UI action). The current session is closed; a fresh session opens bound to `(instance, main)` with its own prompt and MCP.
8. Subsequent instance-opens re-evaluate availability each time. The default mode on entry is `isDefault` if available, otherwise first-available.
9. Setup remains available as a reconfigurator if its `available` still returns true.

The session-closed-and-reopened boundary at step 7 is load-bearing: it's the cleanest way to drop the previous mode's transcript out of context, so the new mode's agent isn't talking to an assistant that was just playing a different role.

## State

Ad hoc per activity. The activity module owns read/write of its own state. Library helpers are provided for common patterns, but using them is optional:

- `readJson<T>(instanceDir, file)` / `writeJson(instanceDir, file, value)`
- `appendJsonl(instanceDir, file, entry)` / `readJsonl(instanceDir, file)`
- Cards: just use the existing card infra directly; instances may hold cards under a subdir if that's the right shape.

Polyglot would probably keep a `state.json` snapshot for mutable fields (lesson, progress) and a `cards/` directory of flashcard cards — ad hoc split, no mandated schema.

## Output channels

Per-mode. During any session the agent uses:

1. **Display text** — rendered in the transcript as Markdown (existing behavior).
2. **`<speech>`** — TTS (existing behavior, inherited from the generic chat).
3. **Mode-declared markup tags** — e.g. `<ADDENDUM type="translation">…</ADDENDUM>`. Rendered by `modes[name].ui.inlineTags[tagName]`.
4. **MCP tools** — state mutation and side effects via `modes[name].mcpServer`.

A mode's sidecar view (`modes[name].ui.SidecarView`) is not an output channel — it's a live view of instance state. It re-renders when state files change. Interactive controls in a sidecar post pre-built user messages through the normal chat route so the interaction lands in the transcript.

## System prompt delivery

`CHAT_SYSTEM_PROMPT + resolve(modes[name].systemPrompt)` via `--append-system-prompt`.

Prompts resolve fresh at session start (function form receives `{ instanceDir }` and may read state). The resolved string is held constant for the life of the session; drift during the session is addressed by the mode's prompt instructing the agent to re-read state files each turn — same approach as today's chat.

**Decision to confirm:** append-to-generic vs. replace-entirely. Appending means modes inherit `<speech>`, `<schedule>`, `<self-note>`, view links, commits, etc. for free. Replacing is cleaner for modes with radically different rules (a pure-notebook mode probably shouldn't schedule alarms). Recommendation: start with append-only; add a per-mode `replaceSystemPrompt: true` opt-out if a real mode needs it.

## MCP servers

One MCP config per mode. Each is launched as a subprocess of the chat session and scoped to that session. Env vars passed in:
- `CB_ACTIVITY_NAME` — the activity type (e.g. `polyglot`)
- `CB_ACTIVITY_ROOT` — absolute path to the instance directory
- `CB_ACTIVITY_MODE` — the mode name (e.g. `setup`, `main`)

Separate servers (rather than one server with a mode flag) give clean tool visibility — the agent only sees tools relevant to the current mode.

## Browse UI

New routes:

- `/:box/activities` — gallery of installed activities. In v1 this is just built-ins; box-local loading is deferred. Each tile shows title, description, icon.
- `/:box/activities/:activityName` — for multi-instance activities, a list of instances + a "new" button. For singleton, redirects to the instance (creating one if missing).
- `/:box/activities/:activityName/:instanceName` — the chat page for the instance in its default available mode. Shows a mode switcher listing every mode whose `available()` returns true.
- `/:box/activities/:activityName/:instanceName/:mode` — explicit mode selection. A direct link to an unavailable mode redirects to the default.

Switching modes in the UI closes the current session and opens a fresh one in the selected mode.

The existing chat page remains the default view at `/:box/chat` (unchanged).

## Resolved decisions

- **Mode switches are manual in v1.** User clicks the mode switcher; agent can suggest but not force a switch. Agent-triggered transitions (e.g. a setup tool that hints "move to main on next send") are a likely v2. Revisit after the first real activity is running.
- **Multiple sessions per `(instance, mode)`** — independent, all mutate the same state files. No shared transcript, no cross-session messaging.
- **Commit discipline** — left to the activity / agent, same as today's chat. Revisit once activity tools are mutating state in practice.
- **Inline tag renderer security** — same story as box-local views. Not a real security boundary; the concern is not breaking page rendering.
- **Availability caching** — cache `available()` results against the filesystem-watch signal. If a mode's `available` is expensive, the activity is doing it wrong.
- **CLI surface** — yes. `cb activity list`, `cb activity new <type> <name>`, `cb activity instances <type>` at minimum. Agents should be able to create and inspect activity instances.
- **Instance CLAUDE.md** — every activity writes a `CLAUDE.md` into the instance directory as part of `createInstance`. The content is typically a short header (name, mode guidance specific to that instance) plus `@`-includes pointing to generic activity docs in the activity source. This gives non-chat agents (wakeups, manual edits) context when working inside the instance dir.

## Open questions

1. **Sidecar live updates.** Tool mutates `state.json` → sidecar should re-render. Should already work on top of the existing file-watch + SSE event bus. Verify during implementation; no new infra expected.

2. **Box-local TS at runtime.** Activities eventually need the same build/dynamic-import story for backend code (MCP server config, `systemPrompt` methods, `available` predicates, activity class) and for frontend sidecar views / inline tags. Box-local views already do this for the frontend — reuse that path. Backend side is unresolved, but v1 ships only built-in activities, so this can be deferred until after polyglot is working.

3. **Frontend icon representation.** `Icon` as a lazy React component is flexible (SVG, inline JSX, imported asset), but a static path/URL might be simpler for the gallery. Pick one during implementation.

4. **Activity `getInstance` subclassing.** The framework's default `ActivityInstance` covers generic state helpers. Activities that want typed state (e.g. `PolyglotInstance.readState(): PolyglotState`) override `getInstance` to return a subclass. Confirm the mode-generic plumbing (`ActivityMode<I extends ActivityInstance>`) is ergonomic in practice.

## Non-goals (v1)

- Dynamic tool visibility within a mode. Accepted cost: agent may call a tool slightly early.
- Raw audio forwarding (`sendRawAudio`). Reserved for a later "plumbing hints" object.
- Non-chat agents invoking activity code (jobs, wakeups).
- Shipping activities outside the callback-box repo (no registry, no install command).
- Cross-box activity sharing beyond copying the directory.

## Starter activity: Polyglot

The first activity should be a port of `~/src/memory-atlas/lib/activities/polyglot/` — reference implementation showing most of the channels in use. Expected structure after porting:

```
src/activities/polyglot/
  index.ts                  # exports Polyglot activity class (default)
  Icon.tsx                  # globe icon component
  instance-claude-template.md  # CLAUDE.md content for each new instance
  setup/
    Mode.ts                 # PolyglotSetup extends ActivityMode
    prompt.md               # static setup system prompt (loaded by the class)
    mcp.ts                  # initializePolyglot, setLearnerProgress
    SidecarView.tsx         # config read-out
  main/
    Mode.ts                 # PolyglotMain extends ActivityMode
    prompt.ts               # compileMainPrompt(state) → string
    mcp.ts                  # addFlashCard, updateLesson, recordTestResult
    SidecarView.tsx         # flashcard browser
    Addendum.tsx            # renders <ADDENDUM type="translation"|"correction">
```

Instance example: `store/activities/polyglot/spanish-ian/` with:
- `state.json` — language, native, lesson, progress
- `cards/*.flashcard.card`
- `CLAUDE.md` — written by `seedInstance` hook from the template, `@`-including generic polyglot docs
- `.callback-box/` — framework-managed, gitignored

No other framework-written files.

Success criteria:
- Setup conversation asks language + level. Setup MCP tool writes the fields to state.
- `main.available()` now returns true; the mode switcher surfaces `main`.
- Switching to `main` opens a fresh session with the compiled main prompt.
- Main session can add flashcards (tool), emit `<ADDENDUM>` translations inline, and the sidecar shows the flashcard deck live-updating.
- Re-opening the instance picks `main` as default — no re-running setup.
- Switching back to `setup` is possible and works as a reconfigurator.

## Build order

A plausible sequence, each step keeping the existing chat unaffected:

1. Base classes (`Activity`, `ActivityInstance`, `ActivityMode`) + activity registry + browse routes + `cb activity` CLI. No behavior change if no activities installed.
2. Built-in Polyglot, `setup` mode only. Confirms prompt resolution, MCP subprocess lifecycle, env vars, `.session-state/` bookkeeping, instance `CLAUDE.md` generation.
3. `main` mode — prompt method, MCP, availability predicate, mode switcher in UI, session handoff on switch.
4. Sidecar view + inline tag renderer plumbing (per-mode).
5. Main-mode tools (addFlashCard etc.) + sidecar live-update via event bus.
6. Box-local activity loading — deferred; v1 is built-in only.

At any step, boxes without activities keep the current chat UI and behavior.
