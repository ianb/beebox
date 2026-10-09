# Bee Box's agent-produced UI surfaces (inventory, 2026-10-08)

The surfaces OpenUI would compete with or complement. Read from the code on
this date; see [README](README.md) for the comparison and dispositions.

## 1. Custom views: agent-authored React modules

- Source: `.tsx` files under the box's `src/views/`. Compiled server-side by
  esbuild (`beebox/src/webapp/views/compiler/compile.ts`) with React and
  `beebox/view-widgets` externalized to `window.__bbxReact` /
  `window.__bbxViewWidgets` shims. Output is a real ES module the frontend
  dynamic-imports (`AgentViewRenderer.tsx`, `loadModule`).
- Binding: a view always renders a card type (`rendersCardTypes`), never a
  card-less standalone surface (`beebox/src/core/views/doc/core.ts`). Card
  pages, chat embeds (`![label](/path)`), the companion pane, and peeks all
  mount the same module.
- Data: the renderer fetches the view's `dependencies` globs as `cards` and
  `files`, subscribes to the bus, and refetches on file change. Views get
  `readFile`/`writeFile`/`commitFile` helpers, `viewHistory` state, and
  `reportActivity`.
- Widgets: `CardLink`, `CardRef`, `Markdown` from `beebox/view-widgets`
  (`beebox/src/frontend/src/exports/view-widgets.tsx`). `Markdown` is the
  only permitted way to render a card body; `bbx view test` renders a view in
  Node and reports violations (`doc/files.ts`, "Card text").
- Trust model: the module is same-origin JavaScript with full DOM and fetch
  access. Nothing sandboxes it. The box agent is the trusted author; the
  protection against a bad view is the error boundary
  (`ViewErrorBoundary`) and the reload-on-fix path, not a capability limit.
- Cost per view: the agent writes a file, the server compiles it, the
  frontend reloads. Minutes of agent work, one commit. Latency to pixels on a
  change is one file-change event plus a compile.

## 2. Figure cards

- A `figure` card's attach scope holds a `.ts` sketch compiled by the same
  esbuild path (`beebox/src/webapp/routes/figure.ts`) and mounted in a
  per-runtime harness (p5, three, d3, canvas-loop).
  Record: `beebox/docs/implemented-plans/figure-card-type.md`.
- Same trust model as views: arbitrary code, no sandbox.

## 3. Markdown bodies and Markdoc tags

- Every Markdown body (cards, chat narration, memos) renders through one
  Markdoc config (`beebox/src/shared/markdoc-config/`). Tags are a fixed
  catalog with typed, validated attributes: `quote`, `source`, `todo`,
  `see-also`, recipe vocabulary, capture vocabulary, `redacted`, and the
  `purpose`/`correction` briefing tags (`tags/core.ts`).
- Raw HTML is an allow-list rebuilt as Markdoc nodes, never `innerHTML`
  (`html-policy.ts`). Unknown tags stay literal text. `Markdoc.validate`
  reports misuse; `bbx validate` calls it.
- This is already a safe-composition language: the model composes a fixed
  component set by name with typed attributes, and bad output degrades to
  text. It streams as Markdown text streams.

## 4. Chat output markup

- Turn-level tags parsed from the assistant reply: `<speech>` (TTS),
  `<callout context loudness>` (`beebox/src/core/chat/callout-tags.ts`),
  `<ack>`, `<schedule>`. Parsed by regex on the completed turn and by the
  frontend during streaming (`Chat/message-parsing.ts`).
- Links: `[label](/path)` opens a card in the companion pane; `![label](/path)`
  embeds the card inline, rendered live by its bound view
  (`views/doc/core.ts`, "Link vs Embed"). `control:` links point at interface
  controls from a `bbx chat ui` dump (`chat/session/prompts.ts`, `ControlRing`).
- So the agent's way to "show a UI" in chat today is: write or reuse a card,
  embed it. There is no inline widget that is not a card.

## 5. Publishing and the iOS app

- Publishing: a `publication` card plus a static folder served by a Cloudflare
  Worker; `index.md` becomes HTML (`beebox/docs/box/publishing.md`). Published
  pages do not run views; they are rendered Markdown and static assets.
- iOS: a WKWebView hosts the same web chat client (`ios-app/CLAUDE.md`,
  "The webview is still the chat client"). Views render there because the
  web app does. There is no native rendering of agent UI.

## 6. Open issues this touches

- [Ad hoc views](../../issues/exploration/2026-07-28-ad-hoc-agent-views.md):
  show something without minting a card. Three directions listed, none
  chosen.
- [Agent show-card action](../../issues/features/2026-09-08-agent-show-card-action.md):
  an explicit "present this card" action.
- [Collection views are badly defined](../../issues/features/2026-08-19-collection-views-are-badly-defined.md):
  no first-class view over a set of cards.
- [Echo Show dashboard](../../issues/features/2026-07-27-echo-show-display-dashboard-view.md):
  a display-only surface on another device.
- [The input](../../beebox/docs/plans/input-widget.md): the composer design,
  where any "chat widget" affordance (forms, choices) would attach.
- Prior art already evaluated: [OpenClaw Canvas / A2UI](../openclaw-hermes/deep-openclaw-canvas-a2ui.md)
  (2026-07-04), which concluded the ephemeral declarative model does not
  contradict the durable-views bet, and that the structured action loop was
  the part worth borrowing.
