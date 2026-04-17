# SSR Render Testing (`cb render`)

## Overview

`cb render` is a CLI tool that renders frontend pages to HTML using React SSR. It's a **UI exploration tool** — render any page in any valid state combination without needing that state to actually exist in the box.

## Basic Usage

```bash
# Render a page with live data from the box
cb render ~/src/boxes/test1 /
cb render ~/src/boxes/test1 /chat
cb render ~/src/boxes/test1 /news

# Extract specific elements
cb render ~/src/boxes/test1 / --selector="h3"
cb render ~/src/boxes/test1 /chat --selector="nav"

# Keep scripts/styles in output
cb render ~/src/boxes/test1 / --raw
```

Output is clean HTML (scripts/styles stripped by default). Stderr has log noise — use `2>/dev/null` for clean output.

## State Exploration

### List available states and scenarios
```bash
cb render ~/src/boxes/test1 /chat --list-states
```
Output:
```
Route: /chat
Machines:
  chat: loading, idle, streaming, refreshing, resetting
  sse: connecting, connected, waiting, disconnected
  ...
Scenarios:
  idle         Chat with history, not streaming
  streaming    Chat mid-response with partial text
  empty        Fresh chat — no messages
  error        Chat with error banner
```

### Render with a named scenario
```bash
cb render ~/src/boxes/test1 /chat --scenario streaming
cb render ~/src/boxes/test1 / --scenario empty
cb render ~/src/boxes/test1 /settings --scenario polling
```

Scenarios combine machine state overrides + tRPC query data overrides into a named preset.

### Override individual machine states
```bash
cb render ~/src/boxes/test1 /chat --machine chat=streaming
cb render ~/src/boxes/test1 /chat --machine chat=idle --machine sse=connected
```

### Override tRPC query data
```bash
cb render ~/src/boxes/test1 / --mock 'status.status={"boxRoot":"/tmp","boxVersion":"1.0.0","created":"2026-01-01T00:00:00Z","git":{"staged":[],"modified":[],"untracked":[],"clean":true},"counts":{"inbox":5,"questions":2,"pendingQuestions":1}}'
```

## How to Use for UI Development & Verification

### 1. Check what a page looks like in different states

Before/after making UI changes, render the page in multiple scenarios to verify nothing breaks:

```bash
# Check all chat scenarios
for scenario in idle streaming empty error recording; do
  echo "=== $scenario ==="
  cb render ~/src/boxes/test1 /chat --scenario $scenario --selector=".flex-1" 2>/dev/null | head -5
done
```

### 2. Verify specific UI elements

Use CSS selectors to focus on the part that matters:

```bash
# Check the inbox count badge
cb render ~/src/boxes/test1 / --selector="h3" 2>/dev/null

# Check nav highlighting for a specific page
cb render ~/src/boxes/test1 /news --selector="nav a" 2>/dev/null

# Check what's in the chat input area
cb render ~/src/boxes/test1 /chat --scenario streaming --selector="textarea" 2>/dev/null
```

### 3. Test empty/error states

Empty states are easy to miss since test boxes usually have data:

```bash
# Empty dashboard — verify it doesn't crash or look broken
cb render ~/src/boxes/test1 / --scenario empty 2>/dev/null | wc -c

# Empty chat — should show some kind of welcome/placeholder
cb render ~/src/boxes/test1 /chat --scenario empty 2>/dev/null
```

### 4. Verify new component changes render correctly

After editing a component, render the affected pages to catch SSR issues:

```bash
# Quick smoke test: all pages render without errors
for route in / /chat /news /questions /history /browse /settings; do
  echo -n "$route: "
  cb render ~/src/boxes/test1 $route 2>/dev/null | wc -c
done
```

### 5. Compare before/after

```bash
# Save before
cb render ~/src/boxes/test1 /chat --scenario streaming 2>/dev/null > /tmp/before.html
# ... make changes ...
cb render ~/src/boxes/test1 /chat --scenario streaming 2>/dev/null > /tmp/after.html
diff /tmp/before.html /tmp/after.html
```

### 6. Inspect specific data rendering

Check that real box data renders correctly by targeting data-driven sections:

```bash
# See what schedules look like
cb render ~/src/boxes/test1 / --selector=".schedule, [class*=schedule]" 2>/dev/null

# Check news brief rendering
cb render ~/src/boxes/test1 /news --selector="article, .brief, [class*=brief]" 2>/dev/null
```

## Architecture

### Key files
- `src/frontend/src/ssr/render.tsx` — Main SSR renderer entry point
- `src/frontend/src/ssr/state-registry.ts` — Machine metadata, route configs, scenarios
- `src/frontend/src/ssr/setup.ts` — Browser API polyfills for SSR
- `src/frontend/src/ssr/css-loader.mjs` — ESM loader that stubs CSS imports
- `src/frontend/src/ssr/register-loader.mjs` — Registers the CSS loader
- `src/frontend/src/hooks/useSSRMachine.ts` — SSR-aware useMachine wrapper
- `src/cli/commands/render.ts` — CLI command that spawns the render process

### How state injection works

1. **XState machines**: `machine.resolveState({ value, context })` creates a snapshot. This is injected via `SSRStateContext` (React context). Components use `useSSRMachine()` instead of `useMachine()` — it checks the context for a pre-built snapshot.

2. **tRPC queries**: `appRouter.createCaller(ctx)` fetches real data from the box filesystem. Results go into a `QueryClient` via `setQueryData()`. Scenario/mock overrides call `setQueryData()` after the real prefetch to overwrite specific queries.

3. **Rendering**: `renderToString()` with `StaticRouter` + all providers (tRPC, QueryClient, SSRStateContext).

### Adding new scenarios

Edit `state-registry.ts`:
- Add to `routeConfigs["/route"].scenarios`
- Each scenario has: `description`, optional `machines` (machineId → state), optional `queryOverrides` (procedure.path → mock data)
- Mock data must match the full shape the component expects (partial data causes crashes)

### Adding new machines

Edit `machineRegistry` in `state-registry.ts`:
- Add the machine with all its states and default contexts
- Add the machine ID to relevant `routeConfigs["/route"].machines` arrays

## Gotchas

- **Mock data must be complete**: Components access nested fields (e.g., `data.git.clean`). Partial mock data causes `Cannot read properties of undefined` errors. Always provide the full shape.
- **`xstate/graph` OOM**: `getShortestPaths()` causes heap exhaustion on complex machines (chatMachine). The registry uses static state lists instead.
- **Stderr noise**: `[ChatSession:init]` and `useLayoutEffect` warnings go to stderr. Use `2>/dev/null`.
- **CSS classes are Tailwind**: No semantic class names like `.chat-messages`. Use structural selectors (`h3`, `nav a`, `textarea`) or Tailwind patterns (`[class*=pattern]`).
- **Route normalization**: Routes match by first path segment only (`/news/some-brief` → `/news`). Sub-routes use the same scenarios as the parent.
