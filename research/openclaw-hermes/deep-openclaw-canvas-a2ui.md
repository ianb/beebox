# Deep dive: OpenClaw Canvas / A2UI

Research date: 2026-07-04. Source: clone of OpenClaw at
`/private/tmp/claude-501/-Users-ianbicking-src-callback-mono/b71d2662-11ec-4f27-9a9a-ef9beea687b1/scratchpad/openclaw` (all paths below are relative to that root unless absolute).

OpenClaw's "Canvas" is really **two stacked capabilities** behind one agent tool:

1. **Freeform HTML canvas** — the agent writes arbitrary HTML/CSS/JS files into a gateway-served directory; paired native apps (macOS/iOS/Android) render them in a WebView.
2. **A2UI** — a constrained, declarative, push-based UI protocol (Google's open A2UI spec, v0.8) rendered by a vendored `@a2ui/lit` web component inside the same WebView.

The repo's own framing: *"Canvas is low-use and experimental. Treat it as a bundled plugin, not a core feature."* (`docs/refactor/canvas.md:1-12`).

---

## 1. The agent's interface

The model-facing tool is created in `extensions/canvas/src/tool.ts:93-221` (`createCanvasTool`), tool name `canvas`, description: `"Control node canvases (present/hide/navigate/eval/snapshot/A2UI). Use snapshot to capture the rendered UI."` (`tool.ts:96-99`). The parameter schema is a single flat TypeBox object in `extensions/canvas/src/tool-schema.ts:27-46`, discriminated by `action`:

```ts
export const CANVAS_ACTIONS = [
  "present", "hide", "navigate", "eval", "snapshot", "a2ui_push", "a2ui_reset",
] as const;                                     // tool-schema.ts:13-21
```

Common parameters (all actions): `gatewayUrl?`, `gatewayToken?`, `timeoutMs?` (gateway call plumbing, `tool.ts:33-39`), and `node?` — a node query resolved to a specific paired device via `resolveNodeIdFromList(await listNodes(...))` with `allowDefault=true` (`tool.ts:41-47,106-110`). Every command becomes a `node.invoke` gateway RPC targeted at that single node, with a fresh `idempotencyKey: randomUUID()` (`tool.ts:112-118`).

### Per-command surface

| action | parameters | native command invoked | behavior |
|---|---|---|---|
| `present` | `target?`/`url?` (string; target preferred, `tool.ts:129-134`), `x? y? width? height?` (finite numbers → `placement`, `tool.ts:122-142`) | `canvas.present` | Show the canvas panel/window on the node, optionally at a URL and screen placement. Returns `{ok:true}`. |
| `hide` | — | `canvas.hide` | Hide the panel (`tool.ts:146-148`). |
| `navigate` | `url` (required; `target` accepted as alias, `tool.ts:149-155`) | `canvas.navigate` | Point the canvas WebView at a new URL. |
| `eval` | `javaScript` (required string, `tool.ts:156-171`) | `canvas.eval` | Run arbitrary JS in the current canvas page; string result returned as tool text. |
| `snapshot` | `outputFormat?` (`"png"\|"jpg"\|"jpeg"`, default png, `tool-schema.ts:24`, `tool.ts:172-177`), `maxWidth?` (positive int), `quality?` (0–1), `delayMs?` (schema-declared, `tool-schema.ts:43`) | `canvas.snapshot` | Screenshot of the rendered canvas, returned to the model as an image (base64 → temp file → `imageResultFromFile`, `tool.ts:183-198`), with configurable image-dimension sanitization (`tool.ts:82-90`). |
| `a2ui_push` | `jsonl?` (inline JSONL string) or `jsonlPath?` (workspace-relative file; path-traversal + symlink-escape checked, `tool.ts:65-80` — `throw new Error("jsonlPath outside workspace")`) | `canvas.a2ui.pushJSONL` | Push one-or-more A2UI v0.8 messages (one JSON object per line) to the node's A2UI renderer (`tool.ts:200-212`). |
| `a2ui_reset` | — | `canvas.a2ui.reset` | Clear all A2UI surfaces (`tool.ts:213-215`). |

Note: the native protocol layer also defines a structured (non-JSONL) `canvas.a2ui.push` command (`apps/shared/OpenClawKit/Sources/OpenClawKit/CanvasA2UICommands.swift:3-10`, mirrored in `apps/android/.../protocol/OpenClawProtocolConstants.kt:40-51`), but the agent-facing TS tool only drives `pushJSONL` — the agent's authoring format is JSONL, period.

### Real agent tool-call examples

From the transcript-summary test (`src/agents/embedded-agent-subscribe.subscribe-embedded-agent-session.includes-canvas-action-metadata-tool-summaries.test.ts:18-23`) — an actual emitted tool-call event:

```js
toolHarness.emit({
  type: "tool_execution_start",
  toolName: "canvas",
  toolCallId: "tool-canvas-1",
  args: { action: "a2ui_push", jsonlPath: "/tmp/a2ui.jsonl" },
});
```

(The test asserts the chat summary shown to the user contains `🖼️`, `Canvas`, and the JSONL path — canvas pushes surface in the transcript as a one-line summary, lines 28-32.)

And the canonical A2UI payload the docs have agents push (`docs/platforms/mac/canvas.md:88-97`):

```bash
cat > /tmp/a2ui-v0.8.jsonl <<'EOFA2'
{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["title","content"]}}}},{"id":"title","component":{"Text":{"text":{"literalString":"Canvas (A2UI v0.8)"},"usageHint":"h1"}}},{"id":"content","component":{"Text":{"text":{"literalString":"If you can read this, A2UI push works."},"usageHint":"body"}}}]}}
{"beginRendering":{"surfaceId":"main","root":"root"}}
EOFA2
openclaw nodes canvas a2ui push --jsonl /tmp/a2ui-v0.8.jsonl --node <id>
```

### The agent-facing skill

`extensions/canvas/skills/canvas/SKILL.md` teaches the freeform-HTML side: *"Use canvas to show HTML on connected Mac/iOS/Android nodes"* (line 9); workflow is "Put HTML/CSS/JS under `plugins.entries.canvas.config.host.root` … Present the hosted URL: `/__openclaw__/canvas/<file>.html` … Use `snapshot` when the user needs proof" (lines 52-58). Its URL-shape example is telling about intended use: `http://<gateway-host>:<gateway.port>/__openclaw__/canvas/games/snake.html` (line 64). Notably, **the skill's "Actions" list omits `a2ui_push`/`a2ui_reset` entirely** (lines 44-50 list only present/hide/navigate/eval/snapshot) — A2UI is documented in platform docs (`docs/platforms/mac/canvas.md`, `docs/nodes/index.md:294-321`) but not in the skill the agent loads.

### Chat-side rendering

`src/chat/canvas-render.ts` extracts "canvas previews" from assistant output for transcript display: a JSON payload of `kind:"canvas"` with a `view.url`/`source.url` (lines 68-131), or a markdown shortcode with `ref`/`url`/`title`/`height` attributes (lines 133-180). A `ref` resolves to `/__openclaw__/canvas/documents/<ref>/index.html` (lines 147-150) — the gateway-served, disk-backed canvas documents dir (see §4). Previews are surface-restricted to `assistant_message` and height-clamped 160–1200px (lines 58-66).

---

## 2. The A2UI protocol

### Message types

A2UI is a server→client message stream. The envelope, from the vendored Zod schema (`apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/CanvasA2UI/a2ui.bundle.js:4074-4079`):

```js
const A2uiMessageSchema = objectType({
  beginRendering:  BeginRenderingMessageSchema.optional(),
  surfaceUpdate:   SurfaceUpdateMessageSchema.optional(),
  dataModelUpdate: DataModelUpdateMessageSchema.optional(),
  deleteSurface:   DeleteSurfaceMessageSchema.optional()
}).strict().superRefine(...)  // exactly one key required
```

The same four keys are enumerated as `A2UI_ACTION_KEYS` in `extensions/canvas/src/a2ui-jsonl.ts:4-10`, in Swift (`CanvasA2UIJSONL.swift:30-35`), and in Kotlin (`apps/android/.../node/A2UIHandler.kt:95`).

- **`beginRendering`** `{ surfaceId, root, catalogId?, styles?: { font?, primaryColor? (hex #rrggbb) } }` — names the root component and (the only agent-controllable global styling) a font + primary color (`a2ui.bundle.js:4001-4009`). The `catalogId` description embeds the spec URL: *"MUST default to the standard catalog for this A2UI version (https://a2ui.org/specification/v0_8/standard_catalog_definition.json)"* (`a2ui.bundle.js:4003`).
- **`surfaceUpdate`** `{ surfaceId, components: ComponentInstance[] (min 1) }` — additive merge into a per-surface component Map; refinements reject duplicate IDs and dangling child references (`a2ui.bundle.js:4010-4067`, handler at `4299-4303`).
- **`dataModelUpdate`** `{ surfaceId, path?, contents }` — *"If omitted, or set to '/', the entire data model will be replaced"* (`a2ui.bundle.js:4068-4072`).
- **`deleteSurface`** `{ surfaceId }` — removes the surface (`a2ui.bundle.js:4073`, handler `4310-4312`).

Each component instance is `{ id, weight? ("CSS flex-grow", only valid under Row/Column), component: {...} }` (`a2ui.bundle.js:3996-4000`).

### Component catalog

From `ComponentPropertiesSchema` (`a2ui.bundle.js:3976-3995`) + the render switch (`buildNodeRecursive`, `4354-4486`) — the complete set:

| Component | Properties |
|---|---|
| `Text` | `text` (bindable), `usageHint: h1\|h2\|h3\|h4\|h5\|caption\|body` |
| `Image` | `url`, `usageHint: icon\|avatar\|smallFeature\|mediumFeature\|largeFeature\|header`, `fit: contain\|cover\|fill\|none\|scale-down`, `altText?` |
| `Icon` | `name` |
| `Video` | `url` |
| `AudioPlayer` | `url`, `description?` |
| `Row` / `Column` | `children` (explicit list or data-bound template), `distribution: start\|center\|end\|spaceBetween\|spaceAround\|spaceEvenly`, `alignment: start\|center\|end\|stretch` |
| `List` | `children`, `direction: vertical\|horizontal`, `alignment` |
| `Card` | `child` (single child ID) |
| `Tabs` | `tabItems: [{title, child}]` |
| `Divider` | `axis`, `color?`, `thickness?` |
| `Modal` | `entryPointChild`, `contentChild` |
| `Button` | `child`, `action`, `primary?: boolean` |
| `CheckBox` | `label`, `value` (bindable bool) |
| `TextField` | `text?`, `label`, `textFieldType: shortText\|number\|date\|longText\|obscured`, `validationRegexp?` |
| `DateTimeInput` | `value`, `enableDate?`, `enableTime?`, `outputFormat?` |
| `MultipleChoice` | `selections` (bindable), `options: [{label, value}]`, `maxAllowedSelections?`, `type: checkbox\|chips`, `filterable?` |
| `Slider` | `value` (bindable number), `minValue?`, `maxValue?`, `label?` |

**Styling/layout ceiling (explicit limitations):**

- There is **no per-component style/CSS property at all**. Beyond the enums above, `weight` (flex-grow), `Divider` color/thickness, and the surface-wide `styles.font`/`styles.primaryColor`, every visual decision (backgrounds, shadows, borders, radii, spacing, gradients) comes from the *client-side theme* — OpenClaw hardcodes `openclawTheme.additionalStyles` in `extensions/canvas/src/host/a2ui-app/bootstrap.js:115-227` (e.g. `Card: { background: "linear-gradient(...)", borderRadius: "14px" }`, `Button: { background: "linear-gradient(135deg, #22c55e 0%, #06b6d4 100%)" }`). An agent cannot override these per instance; two agent-authored surfaces necessarily look alike modulo the enum knobs.
- Unknown component type names pass schema validation (`ComponentPropertiesSchema` ends `.catchall(anyType())`, `a2ui.bundle.js:3995`) but hit the `default:` branch of `buildNodeRecursive` (`4481-4485`) with no matching Lit element — they **render as nothing, silently**. No canvas/charting/freeform-drawing primitive exists; no arbitrary embedding.
- Guards: circular component references throw (`A2uiStateError("Circular dependency for component ...")`, `a2ui.bundle.js:4340`); nested `valueMap` recursion is capped at depth 5 (`a2ui.bundle.js:3763-3775`).
- Native-side validation is shallow — Swift/Kotlin `validateV0_8` only check that exactly one recognized top-level key is present (`CanvasA2UIJSONL.swift:29-64`, `A2UIHandler.kt:85-103`); the Swift test `CanvasA2UITests.swift:11-21` accepts structurally bogus payloads (`{"surfaceUpdate":{"surfaceId":"main","ops":[]}}`). Real structural validation happens only at render time inside the vendored Zod schemas in the WebView.

### Data model / binding

Values are exactly-one-of unions: `{ path? | literalString? }` (and `literalNumber`/`literalBoolean`/`literalArray` variants; `exactlyOneKey` refinement at `a2ui.bundle.js:3718-3729`). Path resolution is JSON-Pointer-*like*, client-side:

- `normalizePath` converts `"bookRecommendations[0].title"` → `/bookRecommendations/0/title` (`a2ui.bundle.js:4264-4266`, the comment gives literally this example); absolute paths (leading `/`) pass through, relative paths get prefixed with the component's `dataContextPath` (`resolvePath`, `4186-4190`).
- The data model is a Map/Array tree with `getDataByPath`/`setDataByPath` walkers that auto-vivify on write (`4267-4278`, `4221-4257`).
- **Templated lists** are the "don't re-push the tree" mechanism: `children` may be `{ template: { componentId, dataBinding } }` instead of `explicitList` (`ComponentArrayReferenceSchema`, `3926-3929`); `resolvePropertyValue` (`4493-4529`) stamps one child per element of the bound array, each with its own `dataContextPath` (`${fullDataPath}/${index}`) and id suffix `:${index}`.
- A narrow `dataModelUpdate` at a `path` re-renders the surface with new values without any `surfaceUpdate`: `handleDataModelUpdate` (`4304-4309`) calls `setDataByPath` then rebuilds the tree from unchanged component definitions.

### Event handling — full round trip (yes, it starts a new agent turn)

1. A `Button`'s Lit element dispatches an `a2uiaction` DOM event; `OpenClawA2UIHost.#handleA2UIAction` (`bootstrap.js:422-525`) resolves `context` bindings against the live data model and builds `userAction = { id, name, surfaceId, sourceComponentId, timestamp, context? }`.
2. Posted to native via `window.webkit.messageHandlers.openclawCanvasA2UIAction.postMessage(...)` (iOS/macOS) or `window.openclawCanvasA2UIAction.postMessage(...)` (Android string-only interface) — `bootstrap.js:493-503`; bridge injection in `extensions/canvas/src/host/a2ui-shared.ts:21-80`.
3. macOS handler (`apps/macos/Sources/OpenClaw/CanvasA2UIActionMessageHandler.swift:36-124`) validates trusted origin, then formats a compact **tag string** (`CanvasA2UIAction.swift:69-81`). Real fixture from `apps/android/.../OpenClawCanvasA2UIActionTest.kt:36`:

   ```
   CANVAS_A2UI action=Get_Weather session=main surface=main component=btnWeather host=Peter_s_iPad instance=ipad16_6 ctx={"city":"Vienna"} default=update_canvas
   ```

4. That string is **sent as a new agent invocation**: `GatewayConnection.shared.sendAgent(GatewayAgentInvocation(message: text, sessionKey: ..., thinking: "low", deliver: false, ..., idempotencyKey: actionId))` (`CanvasA2UIActionMessageHandler.swift:98-106`). So a tap injects a synthetic message into the same session and kicks off a new (low-thinking, non-user-delivered) agent turn. Android mirrors this via a node event `agent.request` with the identical payload shape (`NodeRuntime.kt` ~line 2088; Kotlin formatter `OpenClawCanvasA2UIAction.kt:41-61`); iOS via `NodeAppModel.swift:445`.
5. The `default=update_canvas` suffix is pure prompt engineering — no code interprets it; it tells the LLM its default disposition is to re-render the canvas.
6. Action status is round-tripped back into the WebView as a `openclaw:a2ui-action-status` CustomEvent so a pending-action spinner/toast resolves (`CanvasA2UIAction.swift:83-103`, `bootstrap.js:403-420`).

Additionally, freeform-HTML canvas pages (non-A2UI) can trigger agent runs via deep links: `window.location.href = "openclaw://agent?message=Review%20this%20design"` with params `message, sessionKey, thinking, deliver/to/channel, timeoutSeconds, key` — confirmation-gated unless signed (`docs/platforms/mac/canvas.md:105-115`).

### Versioning

Pinned, not negotiated. Only A2UI **v0.8** is implemented; there is no wire handshake. Three independent layers detect and reject the v0.9 discriminator `createSurface`:

- TS: `extensions/canvas/src/a2ui-jsonl.ts:13` (`type A2UIVersion = "v0.8" | "v0.9"`), detection at 76-93, error `"mixed A2UI v0.8 and v0.9 messages in one file"` (line 87).
- Swift: *"looks like A2UI v0.9 (`createSurface`). Canvas currently supports A2UI v0.8 server→client messages (beginRendering, surfaceUpdate, dataModelUpdate, deleteSurface)."* (`CanvasA2UIJSONL.swift:43-51`).
- Kotlin: same message (`A2UIHandler.kt:89-93`).

The ceiling is hard: the vendored `@a2ui/lit@0.10.0` bundle exports only a `v0_8` namespace (`import { v0_8 } from "@a2ui/lit"`, `bootstrap.js:5`; zero `v0_9` hits in the 12,492-line bundle). Docs confirm: *"Only A2UI v0.8 JSONL is supported (v0.9/createSurface is rejected)"* (`docs/nodes/index.md:320`).

---

## 3. Where it renders

### Gateway serving

Path constants (`extensions/canvas/src/host/a2ui-shared.ts:7-13`): `A2UI_PATH = "/__openclaw__/a2ui"`, `CANVAS_HOST_PATH = "/__openclaw__/canvas"`, `CANVAS_WS_PATH = "/__openclaw__/ws"`. The route adapter (`extensions/canvas/src/http-route.ts:50-71`) sends `A2UI_PATH` requests to the bundled A2UI SPA (`src/host/a2ui.ts`) and everything else to the static-file canvas host (`src/host/server.ts`, serving agent-authored files from `<OPENCLAW_STATE_DIR>/canvas` — `server.state-dir.test.ts:15-33`). The WebSocket path is **live-reload only**: `broadcastReload` sends the literal string `"reload"` on file-watch events (`server.ts:355-367`) — it is not an A2UI state channel. External URL resolution (reverse proxy/non-default bind) via `resolveCanvasHostUrl` (`host-url.ts:14-19`). On non-loopback binds routes require gateway auth; since native WebViews don't send auth headers, paired nodes get **node-scoped, expiring capability URLs** bound to the node's WS session (`docs/gateway/configuration-reference.md:839-844`; SKILL.md line 19: "Paired nodes normally receive node-scoped `pluginSurfaceUrls.canvas` capability URLs").

### Per-platform rendering

| Platform | Stack | Local canvas files | A2UI shell |
|---|---|---|---|
| **macOS** | `NSWindowController` + `WKWebView` in a borderless `NSPanel` (`CanvasWindowController.swift:8,13,41,121`; `CanvasWindow.swift:13`) | Custom URL scheme `openclaw-canvas://<session>/<path>` (`CanvasScheme.swift:4`; `WKURLSchemeHandler` at `CanvasSchemeHandler.swift:8`, root-containment enforced lines 149-152), serving `~/Library/Application Support/OpenClaw/canvas/<session>/` | Plain gateway HTTP: appends `__openclaw__/a2ui/?platform=macos` to the advertised plugin-surface URL and loads it in the same WKWebView (`CanvasManager.swift:235-238,197`) |
| **iOS** | SwiftUI `UIViewRepresentable` wrapping WKWebView, non-persistent data store (`ScreenWebView.swift:5,93-111`) | Bundled `file://` resources from the app bundle: `CanvasScaffold/scaffold.html` and `CanvasA2UI/index.html` via `loadFileURL` (`ScreenController.swift:257-265,58,68`); gateway HTTP only when explicitly navigated (line 70); loopback URLs from remote gateways rejected (lines 37-45) | Bundled `file://` `CanvasA2UI/index.html` by default |
| **Android** | Jetpack Compose `AndroidView` wrapping `WebView`, hardened (`setAllowFileAccess(false)`, etc.) (`CanvasScreen.kt:26,32`) | Bundled APK assets: `file:///android_asset/CanvasScaffold/scaffold.html`, `file:///android_asset/CanvasA2UI/index.html` (`CanvasActionTrust.kt:8,11`; loaded in `CanvasController.kt:84-96,134-149`) | Bundled asset by default |

All three platforms restrict the native A2UI-action bridge to trusted pages only (macOS: scheme check `CanvasA2UIActionMessageHandler.swift:42`; iOS: `isTrustedCanvasUIURL` allows only the two bundled file URLs, `ScreenController.swift:267-283`; Android: `isTrustedPage` gate on `WebViewCompat.addWebMessageListener`, `CanvasScreen.kt:151-165`) — arbitrary web content the canvas navigates to cannot dispatch agent actions.

`CanvasScaffold/scaffold.html` (19.8 KB) is the built-in "home" screen when no agent `index.html` exists — a gateway-status/agent-list dashboard fed by a native bridge call `globalThis.__openclaw.renderHome(payload)` (`scaffold.html` lines 486-511; callers `CanvasController.kt:178-193`, `ScreenController.swift:132-150`). The A2UI renderer proper is the separate vendored bundle (`CanvasA2UI/index.html` 10.2 KB + `a2ui.bundle.js` 394 KB).

### Web fallback

There is no dedicated web canvas app, but because the gateway serves `/__openclaw__/canvas/` and `/__openclaw__/a2ui/` as ordinary HTTP (`docs/gateway/configuration-reference.md:839-840`), **any browser can open them** (auth-gated on non-loopback binds). The browser Control UI renders canvas *previews* inline in chat bubbles (`docs/web/control-ui.md:199`: "canvas previews are left uncollapsed") but is a separate surface.

### Multi-device behavior

**Independent per device; no sync.** A2UI state lives only in each WebView's in-memory processor (`#processor = v0_8.Data.createSignalA2uiMessageProcessor()`, `bootstrap.js:236`; state exists only insofar as `applyMessages` was called on that instance, line 527 — there is no fetch-on-load or server subscription in the bundle). Pushes are explicitly per-node (`--node <id>`; `A2UIHandler.kt:53,131-138` evaluates messages into that device's WebView via `evaluateJavascript`). Pushing to device A does nothing on device B. The only cross-cutting mechanism is the file-watch live-reload WS for on-disk HTML documents — file-content refresh, not A2UI state sync. No broadcast/subscribe code exists in `extensions/canvas` or the app targets.

---

## 4. Lifecycle & persistence

Two different stories, one per layer:

**Freeform canvas documents: persistent, file-backed, replace-semantics.**
- Canvas root: `path.join(stateDir, "canvas")`, documents under `.../documents/<id>/` (`extensions/canvas/src/documents.ts:120-135`).
- `createCanvasDocument` (`documents.ts:300-331`) writes the materialized entrypoint (HTML/image/video/PDF wrapper) plus `manifest.json`; line 310 does `await fs.rm(rootDir, { recursive: true, force: true })` first — a stable document id **replaces** its prior content wholesale (confirmed by `documents.test.ts:91-123`, "reuses a supplied stable document id by replacing the prior materialized view"). No history/versioning of documents.
- These survive gateway restarts trivially — the host is stateless HTTP over a plain directory. No canvas-specific resume logic exists in `server.ts` (grep for `reconnect|resume|restart`: zero hits); clients simply re-fetch after `GatewayNodeSession` reconnects and refreshes the canvas host URL (`GatewayNodeSession.swift:270-291,376-381`; `CanvasManager.swift:142-174` auto-navigates on gateway snapshot pushes).
- macOS re-show: `hide()` only calls `window.orderOut(nil)` — the WKWebView and controller stay alive, so in-process hide/show is a visibility toggle with zero content loss (`CanvasManager.swift:116-120`, `CanvasWindowController.swift:206-212`); window geometry persists across app restarts via `UserDefaults` keyed by session (`CanvasWindowController+Helpers.swift:29-40`). `CanvasFileWatcher.swift` (FSEvents + 250 ms polling fallback) reloads the WebView on file changes.

**A2UI surface state: ephemeral, client-side in-memory only.** No persistence path exists for pushed A2UI messages — no JSONL journal on the gateway, no replay-on-connect, no state snapshot. The surface Map lives in the WebView's JS heap (`bootstrap.js:236`, `handleDeleteSurface` → `this.surfaces.delete(surfaceId)`, `a2ui.bundle.js:4310-4312`). Consequences (inference clearly labeled: derived from absence of any persistence/replay code after targeted search, plus the per-WebView processor design): if the WebView reloads, the app restarts, or the gateway restarts and the panel re-navigates, pushed A2UI UI is gone until the agent pushes again — which is exactly what the `default=update_canvas` action-tag hint anticipates (the agent is expected to re-render in response to events). No "ephemeral" language appears in docs (grep across `extensions/canvas` and the three canvas docs found only an unrelated hit in `bundle-a2ui.mjs:33`), so this is architecture-derived, not doc-stated.

---

## 5. Real usage

Sparse — consistent with the repo's own *"Canvas is low-use and experimental"* (`docs/refactor/canvas.md:10`). Findings from a sweep of `skills/`, `docs/` (~50 canvas-mentioning files), and `CHANGELOG.md`:

- **No bundled demo apps, example galleries, or user-story docs exist.** CHANGELOG canvas/a2ui entries are uniformly infra/security (auth hardening, path traversal fixes, TLS scheme handling, lazy-loading). `skills/obsidian/SKILL.md:32` mentions "Canvases: `*.canvas` JSON" — that's Obsidian's unrelated format.
- The most concrete documented artifact is the docs' A2UI smoke test — a `Column` with an `h1` and body `Text` (`docs/platforms/mac/canvas.md:88-97`, quoted in §1).
- The most compelling *pattern* documented is the two-way control surface: an agent-authored HTML page (e.g. a review form) that hands control back to the agent via `openclaw://agent?message=...` deep links (`docs/platforms/mac/canvas.md:105-115`) — with `sessionKey`, `thinking`, `deliver`, and a signed `key` to skip the confirmation prompt.
- The skill's own aspiration hint: `/__openclaw__/canvas/games/snake.html` (`extensions/canvas/skills/canvas/SKILL.md:64`) — freeform HTML games/toys served to a paired device, which (inference) is the realistic freeform-canvas use profile: quick, throwaway, single-device visual output with `snapshot` as agent-visible proof.

---

## 6. Origin & ecosystem

**A2UI is not OpenClaw's invention — it is Google's open A2UI spec, consumed as a third-party npm dependency and vendored as a built bundle.**

- Dependency: `"@a2ui/lit": "0.10.0"` (`extensions/canvas/package.json:11`; root `package.json:2027`; `pnpm-lock.yaml:1988-1996`, which also pulls `@a2ui/web_core@0.10.0` and peer `@a2ui/markdown-it`).
- Attribution: the vendored bundle carries a license header *"Copyright 2026 Google LLC, Apache-2.0"* (`apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/CanvasA2UI/a2ui.bundle.js:3701-3714`), and the schema embeds the spec URL `https://a2ui.org/specification/v0_8/standard_catalog_definition.json` (`a2ui.bundle.js:4003`).
- The versioned namespace import `import { v0_8 } from "@a2ui/lit"` (`extensions/canvas/src/host/a2ui-app/bootstrap.js:5`) and OpenClaw's deliberate v0.9 rejection (§2) show OpenClaw tracking an externally-evolving spec, pinned at v0.8 even though the npm package is 0.10.0.
- Vendoring chain: `@a2ui/lit` npm package → rolldown-bundled by `extensions/canvas/scripts/bundle-a2ui.mjs` (which treats the package as optional: `require.resolve("@a2ui/lit")` with "A2UI package missing; keeping prebuilt bundle" fallback, lines 178-186) → copied into native app resources by `scripts/sync-native-a2ui.mjs:13-27` (copies the already-built `a2ui.bundle.js` + `index.html` into `apps/shared/OpenClawKit/.../Resources/CanvasA2UI/` for Swift consumption; Android gets the same assets). The `"@openclaw/a2ui-theme-context"` import is an alias into a file *inside* `@a2ui/lit` (`rolldown.config.mjs:18-19`), not a real package.
- Gap noted: `THIRD_PARTY_NOTICES.md` has no a2ui/Google entry (grep: zero hits) — an attribution-file omission, not counter-evidence.

**OpenClaw's own contribution** is the integration layer: the `canvas` agent tool + JSONL validation (`extensions/canvas/src/tool.ts`, `a2ui-jsonl.ts`), gateway HTTP serving (`http-route.ts`, `host/server.ts`, `host/a2ui.ts`), the Lit host element with the OpenClaw theme and native action bridge (`host/a2ui-app/bootstrap.js`), three native WebView embeddings with trust gating, and the action→agent-turn round trip (`CANVAS_A2UI ...` tag format, defined in triplicate in Swift/Kotlin and matching tests).

---

## 7. Honest assessment vs the compiled-React-views alternative

Context: Callback Box has agents author **persistent compiled React (.tsx) views attached to durable data cards**, revisitable and composable later. Canvas/A2UI is an **ephemeral, push-based, device-rendered** model. Assessment strictly from what the code shows; inferences labeled.

### Genuine strengths of Canvas/A2UI

1. **Zero build step, zero code execution for A2UI.** An A2UI push is pure declarative JSON validated by Zod schemas and rendered by a pre-built, fixed component library (`a2ui.bundle.js:3976-4079`). There is no compiler in the loop, no agent-authored executable code, and correspondingly no build-failure mode. Latency from tool call to pixels is one `node.invoke` + one `evaluateJavascript` (`A2UIHandler.kt:131-143`).
2. **A real safe subset with defense-in-depth.** The A2UI path is much safer than arbitrary code: fixed component catalog, no per-component CSS, action dispatch restricted to trusted bundled pages on all three platforms (§3), workspace path-traversal checks on `jsonlPath` (`tool.ts:65-80`), hardened WebViews (`CanvasScreen.kt` file-access off), and node-scoped expiring capability URLs for gateway access. Note the caveat: the *freeform HTML* half of Canvas plus `eval` (`tool.ts:156-171`) is full arbitrary JS in a WebView — OpenClaw ships both the safe subset and the unsafe escape hatch side by side.
3. **True cross-device native reach.** The same JSONL renders in a macOS panel, an iOS screen, and an Android Compose-hosted WebView with per-platform protocol implementations kept in triplicate lockstep (Swift/Kotlin/TS command constants and validators). The action round trip works identically everywhere, down to a shared tag format with cross-platform test fixtures (`OpenClawCanvasA2UIActionTest.kt:36`). Callback Box's browser-based React views can't appear in a native menu-bar panel on a paired phone without a comparable native client investment.
4. **Live incremental updates via data binding.** `dataModelUpdate` at a JSON-pointer path + templated lists (§2) let an agent update a rendered value or grow a list without resending the component tree — a genuinely nice protocol property for streaming/monitoring UIs. Compiled React achieves this only by rebuilding or by the view fetching data itself.
5. **Clean interaction-to-agent loop.** A button tap becomes a structured, idempotency-keyed, low-thinking agent turn with bound context (`ctx={"city":"Vienna"}`) — a tight, well-engineered "UI as agent prompt" loop with pending-state UX (`openclaw:a2ui-action-status`).

### Genuine weaknesses

1. **Hard expressiveness ceiling.** ~18 components, enum-only layout knobs, one font + one primary color per surface, all real styling hardcoded client-side (`bootstrap.js:115-227`), unknown components silently render nothing. No charts, no tables (beyond List), no canvas/SVG, no custom composition. Every A2UI surface looks like the OpenClaw theme. Compiled React has no such ceiling.
2. **No persistence, no revisit.** A2UI state is WebView-heap-only (§4). Nothing to reopen tomorrow, link to, or diff. The freeform-document half *is* disk-backed but with destructive replace-by-id semantics (`documents.ts:310`) and no history. Callback Box's whole premise — views as durable artifacts attached to durable data — has no counterpart here; the closest thing is "the agent will re-push when poked" (`default=update_canvas`).
3. **No composition.** Surfaces don't reference other surfaces, documents, or data sources; there is no card/entity model to attach to. Each push is a standalone screen for one device. Multi-device is explicitly independent state (§3).
4. **Split-brain design and low investment.** The safe A2UI subset and the unsafe HTML+`eval` canvas coexist in one tool, the agent skill doesn't even teach the A2UI actions (SKILL.md omits `a2ui_push`), validation depth differs by layer, the spec is pinned at v0.8 against an upstream already at v0.9+, and the maintainers label the whole thing "low-use and experimental" slated for plugin-ization (`docs/refactor/canvas.md:1-12`). (Inference: A2UI here is a tracked bet on Google's spec, not a load-bearing product pillar.)
5. **Triple-implementation tax.** Protocol constants, validators, and action formatting are hand-mirrored in TS, Swift, and Kotlin — a real maintenance cost visible in the repo, and the price of the native-reach strength above.

### Bottom line

Canvas/A2UI is best understood as an **ephemeral remote-display channel with a button-to-agent-turn loop** — excellent for "show me a control panel on my phone right now," structurally incapable of "keep this dashboard attached to this data and let me come back to it." The two models optimize opposite ends: A2UI trades expressiveness and durability for safety, latency, and native reach; compiled React views trade build complexity and sandboxing burden for unbounded expressiveness, persistence, and composition. Nothing found in OpenClaw's code contradicts Callback Box's bet — indeed OpenClaw's own docs treat the ephemeral model as experimental and low-use — but the A2UI event loop (structured action → context-bound synthetic agent turn → incremental data-model patch) is the one piece genuinely worth studying and possibly borrowing.
