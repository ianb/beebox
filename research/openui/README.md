# OpenUI (Thesys) review

Research date: 2026-10-08. OpenUI ([openui.com](https://www.openui.com/),
[thesysdev/openui](https://github.com/thesysdev/openui)) is Thesys Inc.'s
"open standard for intelligent UI": a model streams UI in a line DSL
(OpenUI Lang) that a renderer composes from host-registered components.
Snapshot, not a living doc; see [research/AGENTS.md](../AGENTS.md).

## Documents

| Document | What it covers | Status |
| --- | --- | --- |
| [hands-on.md](hands-on.md) | The language, parser, streaming, component model, failure handling, measured tokens and latency, renderer coverage. Scratch lab with real model calls (about $0.07). | done |
| [project-and-governance.md](project-and-governance.md) | License, governance, Thesys and its paid tier, maturity, adoption, reception, name history. | done |
| [alternatives.md](alternatives.md) | The 2026 generative-UI field: MCP Apps, A2UI, json-render, Vercel AI SDK, CopilotKit, LangGraph, Anthropic, markup approaches. Comparison table and convergence evidence. | done |
| [beebox-surfaces.md](beebox-surfaces.md) | Inventory of how Bee Box agents produce UI today, read from code. | done |
| [beebox-fit.md](beebox-fit.md) | Reasoning behind the dispositions below. | done |

## Findings in ten lines

1. OpenUI Lang is `name = Component(positional, args, [refs])`, one statement per line; a hand-written TypeScript parser autocloses the pending line and re-materializes the tree per chunk. No grammar file, no constrained decoding.
2. The catalog reaches the model as text in the system prompt: 9,125 tokens for the default 82-component library. Hosts can register their own components with Zod and the prompt follows.
3. Validation drops or defaults invalid nodes and reports structured errors; nothing throws. Enum checks are skipped while a line is partial, so a half-typed enum reaches the DOM.
4. The format has no HTML or JS path. Remaining risk sits in host components (`Image(src)`, `@OpenUrl`).
5. "67% fewer tokens" is one scenario against pretty-printed JSON. Against minified JSON: 12% in the repo's own samples, 16 to 42% in ours. Asking the model for JSON directly used fewer completion tokens in two of three cases.
6. Only React has a component library. Vue, Svelte, Angular ship a renderer and expect host components; React Native is an export condition; email is React Email wrappers.
7. Single vendor, seed stage, all packages 0.x, weekly releases; react-ui 0.17.0 renamed chart props with no breaking label. No spec file, foundation, CLA, or trademark policy. The paid tier is Gateway/Autofix at api.thesys.dev.
8. `lang-core` ships opt-out `postinstall` telemetry keyed by the git origin; pnpm 10 blocks it.
9. Adoption is real but shallow: 163k weekly downloads for the React renderer, eight self-listed adopters, two write-ups without numbers, one HN thread at 34 points.
10. The field converged elsewhere: MCP Apps (sandboxed HTML, 11 hosts) for UI inside other clients; A2UI and json-render for JSON trees; tool-call-to-component in every chat SDK. OpenUI Lang has one implementer.

## Dispositions

| Idea | Disposition | Traced to |
| --- | --- | --- |
| Adopt `@openuidev/*` packages or OpenUI Lang for custom views | **reject** | Views are trusted agent code by design (`beebox/src/webapp/views/compiler/compile.ts`); the catalog has no card model, no file access, no map; same verdict as [A2UI review §7](../openclaw-hermes/deep-openclaw-canvas-a2ui.md). |
| OpenUI as a "safer" card view language | **reject** | Markdoc is already the safe-composition layer (`beebox/src/shared/markdoc-config/`); a second language is two tiers of one thing. |
| Interactive chat widgets (forms, option buttons posting back to the agent) | **reject** | Boxholder wontfix 2026-07-10: [in-chat interactive questions](../../issues/closed/features/2026-06-09-in-chat-interactive-questions.md); `box/questions/` is the structured-question primitive. |
| Ad hoc display without a card: fixed catalog, streamed, validated, inline data | **adapt** | As Markdoc data tags (`{% table %}`, `{% chart %}`) in the chat reply, not a new language. Amended into [ad-hoc agent views](../../issues/exploration/2026-07-28-ad-hoc-agent-views.md) with this evidence. Markdoc already renders an unclosed tag mid-stream. |
| Model-facing structured validation errors (code, path, message, unit id) | **adapt, inside the above** | `bbx validate` already reports Markdoc errors; the data-tag design should shape chat-turn errors the same way. No separate issue. |
| Positional-argument DSL | **reject** | Fragile under model drift (named-arg attempts become unresolved refs); Markdoc's named attributes are the right call for our tags. |
| Token-saving claim as a design input | **reject** | Measured 12 to 42% vs minified JSON; data-heavy UIs near zero. Record the measurement method ([beebox-fit §5](beebox-fit.md#5-what-to-take)). |
| Cross-platform renderers (RN, email, script tag) | **reject** | iOS hosts the web client in a WKWebView; publishing renders Markdown; nothing to gain. |
| MCP Apps as the surface for box UI inside other clients | **later** | Belongs with [box as an MCP server](../../issues/features/2026-09-17-box-as-mcp-server-hands-out-tasks.md) when that is picked up; noted there. |
| `@openuidev/a2ui` bridge, OUI-1 model, Gateway/Autofix | **reject** | Experimental, hosted, or irrelevant to a Claude Code agent writing files. |

## What I would actually do

Nothing now. The boxholder's reaction (2026-10-08): Markdoc data tags only if
a need is felt, and none is felt yet; card embeds cover the known cases. The
direction is recorded in the ad-hoc views exploration for when a need
appears. Re-check OpenUI only if a second independent implementer of OpenUI
Lang appears or a spec leaves the Thesys repo.
