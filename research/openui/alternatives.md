# Generative-UI landscape, 2026-10-08

Survey of the alternatives OpenUI (Thesys) competes with. Public web sources
only. OpenUI itself is covered in a sibling note; here each entry ends with
the one-line difference from OpenUI. Dispositions live in the [README](README.md).

## Summary

1. Three wire shapes exist: tool-linked HTML in a sandboxed iframe (MCP Apps, ChatGPT), a flat JSON component tree against a fixed catalog (A2UI, json-render, C1), and a tool call the client maps to a component (Vercel AI SDK, CopilotKit, assistant-ui, LangGraph).
2. OpenUI is the only shipped approach whose wire format is a non-JSON DSL ("OpenUI Lang", `id = Component(...)` lines) rendered progressively per line ([openui.com](https://openui.com/docs/openui-lang)).
3. The iframe camp converged: MCP-UI, OpenAI Apps SDK and the MCP Apps extension merged into one spec (2026-01-26), implemented by Claude, ChatGPT, VS Code, Cursor, M365 Copilot, Goose, Postman ([client matrix](https://modelcontextprotocol.io/extensions/client-matrix)).
4. The JSON-tree camp did not converge: A2UI (Google, v0.9.1, v1.0 RC) and json-render (Vercel Labs, 0.21) are separate formats; CopilotKit and AG-UI transport all of them.
5. Vercel's RSC `streamUI` stays "experimental"; Vercel recommends `useChat` tool parts plus AI Elements, and separately ships json-render as a labs product ([ai-sdk.dev](https://ai-sdk.dev/docs/ai-sdk-rsc/overview)).
6. Google's consumer "Generative UI" (Gemini app, AI Mode) has the model write full HTML/CSS/JS, a different design from its own A2UI ([research.google](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/)).
7. Anthropic ships no generative-UI SDK. Claude Artifacts and Claude Design are code-emitting canvases; Claude.ai renders MCP Apps.
8. Thesys archived C1 (hosted JSON DSL) in favor of OpenUI; OpenUI Cloud is the paid layer ([docs.thesys.dev/legacy](https://docs.thesys.dev/legacy)).
9. Abandoned since 2024: ai-jsx (Fixie). Still pushed but low-activity: wandb/openui, llm-ui. No standards body hosts a generative-UI spec; AAIF has no UI working group.
10. Could not verify: npm download spikes for json-render/ext-apps as organic, A2UI partner lists beyond CopilotKit, "Open-JSON-UI" as an OpenAI publication, Claude Code rendering MCP Apps.

Numbers below: GitHub API stars and `pushed_at`, npm registry versions and last-week downloads, all fetched 2026-10-08.

## 1. Vercel AI SDK: `streamUI`/RSC and `useChat` tool parts

- Version `ai` 7.0.133 (2026-10-08), Apache-2.0, 34.5M downloads/week, 27.2k stars ([npm](https://registry.npmjs.org/ai), [repo](https://github.com/vercel/ai)).
- RSC path: `@ai-sdk/rsc` 3.0.133, 140k/week. Docs: "AI SDK RSC is currently experimental. We recommend using AI SDK UI for production" with a migration guide ([overview](https://ai-sdk.dev/docs/ai-sdk-rsc/overview)). Not deprecated, not removed.
- Recommended path ([generative-user-interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)):
  - (a) Model emits ordinary tool calls. Client switches on `part.type === 'tool-<name>'`.
  - (b) Part states `input-available`, `output-available`, `output-error`. Component appears when the call is complete; partial-argument rendering not documented (UNVERIFIED).
  - (c) Fixed set of app-defined tools and components; no sandbox needed.
  - (d) Tools registered server-side with Zod schemas; model sees JSON Schema. Component mapping is hand-written client code.
  - (e) `useChat` for React, Vue, Svelte, Angular (per-framework parity UNVERIFIED).
- AI Elements: shadcn/ui registry with Tool, Reasoning, Plan, Artifact components; a chat kit, not a model-driven UI generator. `ai-elements` 1.9.0 (2026-03-12), 148k/week, 2.5k stars ([elements.ai-sdk.dev](https://elements.ai-sdk.dev/), [npm](https://registry.npmjs.org/ai-elements)).
- vs OpenUI: one component per tool call, chosen by developer code; no composition language, no streaming of layout.

## 2. json-render (Vercel Labs)

- `vercel-labs/json-render`, created 2026-01-14, labeled "LABS PRODUCT". 18.6k stars, Apache-2.0, v0.21.0 (2026-09-18). `@json-render/core` 2.35M/week, `@json-render/react` 1.27M/week ([repo](https://github.com/vercel-labs/json-render), [npm](https://registry.npmjs.org/@json-render/core)).
- (a) Flat JSON `{root, elements}` map; optional YAML wire format (`@json-render/yaml`) with its own streaming parser.
- (b) `createSpecStreamCompiler().push(chunk)` yields partial result plus patches; patch format not read (UNVERIFIED).
- (c) Fixed catalog: "AI can only use components in your catalog"; actions predefined; no sandbox.
- (d) `defineCatalog` with Zod prop schemas and descriptions; `catalog.prompt()` emits system-prompt text.
- (e) Renderers: React, Vue, Svelte, Solid, React Native, Ink, Remotion, React PDF, React Email, React Three Fiber.
- (f) No named users found. Also appears as a CopilotKit "BYOC json-render" guide ([docs](https://docs.copilotkit.ai/langgraph-python/generative-ui/json-render)).
- vs OpenUI: same catalog-plus-prompt design; JSON or YAML tree instead of a line DSL; renderer list is wider.

## 3. MCP-UI, MCP Apps, OpenAI Apps SDK

### MCP Apps extension (official)
- SEP-1865; spec `2026-01-26` marked Stable, first official MCP extension, announced by MCP maintainers as building on MCP-UI and the ChatGPT Apps SDK ([blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/), [spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)).
- (a) Model emits a tool call. Tool `_meta.ui.resourceUri` points to a `ui://` resource with MIME `text/html;profile=mcp-app`; host fetches via `resources/read`. Model never emits HTML.
- (b) Host sends `tool-input-partial` while arguments stream (best-effort JSON), then `tool-result`. The HTML shell is static; only data is progressive.
- (c) Sandboxed iframe on a separate origin, default CSP `default-src 'none'`, server-declared `csp` and `permissions`, `ui/*` JSON-RPC over postMessage, host consent for UI-initiated tool calls.
- (d) Registration through tool metadata and resources; `_meta.ui.visibility` hides app-only tools from the model.
- (e) Hosts: Claude web/desktop, ChatGPT, Cursor, VS Code Copilot, M365 Copilot, Goose, Postman, MCPJam, Archestra, PostHog Code ([client matrix](https://modelcontextprotocol.io/extensions/client-matrix)). Claude Code not listed.
- (f) `@modelcontextprotocol/ext-apps` 2.0.3 (2026-09-25), 5.3M/week, 2.9k stars. License moving MIT to Apache-2.0 ([LICENSE](https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/LICENSE)). Deferred: `externalUrl`, multiple resources per tool, state persistence, non-HTML renderers.
- vs OpenUI: developer-authored HTML app per tool, not model-composed UI; cross-host by iframe, not by component registry.

### MCP-UI (idosal, Liad Yosef)
- Moved to `MCP-UI-Org/mcp-ui`: 5.2k stars, Apache-2.0, last push 2026-09-16; README says it now implements MCP Apps; legacy `rawHtml`, `externalUrl`, `remote-dom` types remain in examples ([repo](https://github.com/MCP-UI-Org/mcp-ui)). `@mcp-ui/client` 7.1.1 (2026-05-09), 407k/week; Ruby and Python server SDKs.
- Hosts listed: Goose, LibreChat, Nanobot, MCPJam, ChatGPT via adapter. Shopify/HuggingFace adoption UNVERIFIED.
- vs OpenUI: an SDK for the iframe standard above; `remote-dom` was its only catalog-style mode and is now legacy.

### OpenAI Apps SDK (ChatGPT)
- ChatGPT implements MCP Apps; `window.openai` is "an optional ChatGPT-only layer" for checkout, files, modals. `_meta["openai/outputTemplate"]` is an alias for `_meta.ui.resourceUri` ([mcp-apps-in-chatgpt](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)). Docs now say "plugins" and "ChatGPT Directory" with public review ([apps-sdk](https://developers.openai.com/apps-sdk)).
- Deprecation of `text/html+skybridge` found only in third-party guides (UNVERIFIED). ChatGPT lacks UI-initiated tool calls per [Alpic](https://alpic.ai/blog/mcp-apps-goes-official-claude-chatgpt-support).
- "Open-JSON-UI", described by CopilotKit as "an open standardization of OpenAI's internal declarative Generative UI schema" ([docs](https://docs.copilotkit.ai/generative-ui-specs/open-json-ui)): no OpenAI publication found (UNVERIFIED as an OpenAI artifact).
- Convergence: yes on the iframe model; parity gaps remain for files, modals, checkout.

## 4. A2UI (Google) and Google GenUI

### A2UI
- Repo moved to `a2ui-project/a2ui` (google/A2UI redirects): 16.6k stars, Apache-2.0, pushed 2026-10-08. Site: v1.0 "Release candidate", v0.9.1 "Current production release", v0.9 stable, v0.8 legacy; MIME `application/a2ui+json` ([a2ui.org](https://a2ui.org/), [v0.9 spec](https://a2ui.org/specification/v0.9-a2ui/)). "Created by Google with contributions from CopilotKit and the open source community"; no Linux Foundation move found.
- (a) JSONL envelopes: `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`; flat component list linked by id; `root` required.
- (b) One JSON object per line over A2A parts, SSE or WebSocket; forward references render as placeholders.
- (c) Declarative data, no code; only catalog components; functions by name; surface data goes only to its originating server.
- (d) Catalog is a JSON Schema document, placed in the prompt ("prompt-first"); model is not constrained, so the client validates and returns `VALIDATION_FAILED`.
- (e) Renderers: Lit, Angular, Flutter (via genui), Markdown; React via "A2UI Theater" examples; Compose and SwiftUI on roadmap. `@a2ui/lit` 0.12.0 (2026-09-28), 527k/week.
- (f) Python `a2ui-core` 0.3.0 / `a2ui-agent-sdk` 0.8.0 published 2026-10-08. Transport over A2A (one envelope per Part) and AG-UI. Partners beyond CopilotKit UNVERIFIED. Evaluation papers exist: A2UI-Bench ([arXiv 2605.24830](https://papers.cool/arxiv/2605.24830)).
- vs OpenUI: JSON Schema catalog in prompt plus post-validation; JSONL rather than a line DSL; carried by A2A, so agent-to-agent reach rather than a React SDK.

### Flutter genui and Gemini "Generative UI"
- `flutter/genui`: 1.8k stars, BSD-3-Clause, "highly experimental"; pub.dev 0.10.4; uses A2UI internally, being split into `a2ui_core`, `a2ui_agent`, `a2ui_flutter` ([repo](https://github.com/flutter/genui), [pub.dev](https://pub.dev/packages/genui)).
- Gemini app "dynamic view"/"visual layout" and Search AI Mode: Gemini 3 Pro emits full HTML/CSS/JS with tools and post-processors; shipped to US Pro/Ultra ([research.google](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/), paper [arXiv 2604.09577](https://generativeui.github.io/)). Sandbox details not published.
- No Gemini API or Firebase AI Logic generative-UI endpoint found (UNVERIFIED as absence).

## 5. AG-UI, CopilotKit, LangGraph, assistant-ui

### AG-UI (CopilotKit)
- Event protocol, not a UI format: lifecycle, text, tool-call (Start/Args/End/Result), state snapshot/delta, activity, reasoning events ([events](https://docs.ag-ui.com/concepts/events)). 16.4k stars, MIT, `@ag-ui/core` 1.0.2 (2026-10-05), 2.85M/week; date-tagged releases ([repo](https://github.com/ag-ui-protocol/ag-ui)).
- "Natively supports" A2UI, Open-JSON-UI, MCP-UI/MCP Apps as payloads ([generative-ui-specs](https://docs.ag-ui.com/concepts/generative-ui-specs)). Integrations: LangChain, CrewAI, Microsoft Agent Framework, Google ADK, AWS Strands, Mastra, Pydantic AI, Agno, LlamaIndex, AG2; SDKs in Kotlin, Go, Dart, Java, Rust, Ruby, C++, .NET. Governance: biweekly working group; no LF status found.
- vs OpenUI: transport layer; OpenUI ships an AG-UI package and rides on it.

### CopilotKit
- 37.8k stars, MIT, v1.77.2 (2026-10-08), `@copilotkit/react-core` 616k/week ([repo](https://github.com/CopilotKit/CopilotKit)).
- Six generative-UI primitives: Components as Tools (`useComponent` with Zod `parameters`, model emits tool call), Tool Call Rendering (partial-JSON args streamed, status InProgress/Executing/Complete), State Rendering, Reasoning, A2UI (`createA2UIMessageRenderer`), MCP Apps in sandboxed iframe ([specs](https://docs.copilotkit.ai/generative-ui/specs), [generative-ui](https://docs.copilotkit.ai/generative-ui)).
- vs OpenUI: a host that renders several formats; its native primitive is tool-call-to-component, not a composition language.

### LangChain / LangGraph generative UI
- Agent pushes "UI messages" (`push_ui_message(name, props)` / `typedUi().push`) tied to an AI message; same id re-pushed updates in place during generation ([docs](https://docs.langchain.com/langsmith/generative-ui-react)).
- Components live in developer `ui.tsx`, declared in `langgraph.json` `ui`, bundled and served by LangSmith; `LoadExternalComponent` renders inside shadow DOM (style isolation only; arbitrary developer React, no sandbox). Model does not pick components from a catalog; agent code does.
- Status: still documented; newer frontend docs list CopilotKit, AI Elements, assistant-ui and OpenUI as renderers ([overview](https://docs.langchain.com/oss/javascript/langchain/frontend/integrations/overview)). `@langchain/langgraph-sdk` 5.0M/week (whole SDK). MIT.
- vs OpenUI: developer-chosen component names and props; no model-facing language.

### assistant-ui
- 12.4k stars, MIT, `@assistant-ui/react` 0.15.25 (2026-10-06), 2.37M/week, YC-backed, paid Assistant Cloud ([repo](https://github.com/assistant-ui/assistant-ui)). Tool calls rendered via `makeAssistantToolUI`; streaming and catalog-to-model mechanism UNVERIFIED. OpenUI ships an assistant-ui package.
- vs OpenUI: tool-call-to-component chat kit.

## 6. Anthropic

- Claude Artifacts: model writes code (documents, decks, designs, dashboards, interactive tools) for a side panel; 2026 adds Design/Slides/Docs templates, export, artifacts that call Claude as the viewer, connectors, 20 MB storage, Claude Code publishing ([help](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)). Tagged-block emit format and iframe sandbox details are not in public docs (UNVERIFIED from sources).
- Claude Design (Anthropic Labs, 2026-04-17): prototypes, slides, one-pagers; export Canva/PDF/PPTX/HTML ([news](https://www.anthropic.com/news/claude-design-anthropic-labs)).
- Claude.ai and Claude Desktop render MCP Apps; Claude requires domain signing ([Alpic](https://alpic.ai/blog/mcp-apps-goes-official-claude-chatgpt-support)).
- No first-party generative-UI feature in Agent SDK or Managed Agents found. CopilotKit claims Managed Agents are AG-UI compatible ([blog](https://www.copilotkit.ai/blog/claude-managed-agents-agui-compatible)); first-party status UNVERIFIED.
- vs OpenUI: arbitrary code in a sandbox (Artifacts) or hosted HTML apps (MCP Apps); no fixed-catalog composition.

## 7. C1 by Thesys (hosted)

- Archived; docs at `docs.thesys.dev/legacy`, OpenUI named successor, APIs "keep working", migration guide `C1Component` to `AgentInterface` ([legacy](https://docs.thesys.dev/legacy), [migration](https://www.openui.com/docs/agent/guides/migrating)).
- (a) OpenAI-compatible endpoint `api.thesys.dev/v1/embed`, model ids like `c1/anthropic/claude-sonnet-4/v-20250930`, output "C1 DSL" (JSON per OpenUI's benchmark label; syntax not published) ([api](https://docs.thesys.dev/legacy/api-reference/getting-started)). (b) `C1Component` re-renders the accumulated string with `isStreaming` ([streaming](https://docs.thesys.dev/legacy/guides/streaming)). (c) Fixed Thesys component set. (d) Catalog is Thesys-owned; function tools only.
- `@thesysai/genui-sdk` 0.10.3 (2026-07-01), custom license, 10k/week. Pricing page now sells OpenUI Cloud: Free 3K calls, $49/25K, $499/500K ([pricing](https://www.thesys.dev/pricing)). OUI-1 fine-tuned model reported only by a secondary source ([runtimewire](https://runtimewire.com/article/thesys-ships-oui-1-local-generative-ui-model), UNVERIFIED).
- vs OpenUI: hosted model plus fixed catalog, JSON DSL; OpenUI opens the catalog and the format.

## 8. Declarative markup and HTML-emitting approaches

- Markdoc (Stripe): MIT, 8.5k stars, `@markdoc/markdoc` 0.5.10, 720k/week; not LLM-specific ([repo](https://github.com/markdoc/markdoc)). mdocUI: alpha, 40 stars, model writes Markdown with `{% tag %}` syntax, Zod registry generates the prompt, shimmer for incomplete tags, React plus web components ([repo](https://github.com/mdocui/mdocui)).
- Streaming Markdown renderers: `streamdown` (Vercel) 2.7.0, 8.1M/week, repairs unterminated fences ([repo](https://github.com/vercel/streamdown)); `react-markdown` 10.1.0, 44M/week, custom component mapping ([repo](https://github.com/remarkjs/react-markdown)); `llm-ui` 1.7k stars, npm release 2024-06, custom blocks in LLM output ([repo](https://github.com/richardgill/llm-ui)).
- Open WebUI (154k stars, custom license): tools return HTML embedded as iframes; Artifacts render in srcdoc iframes with sandbox and optional `IFRAME_CSP` ([rich-ui](https://docs.openwebui.com/features/extensibility/plugin/development/rich-ui), [artifacts](https://docs.openwebui.com/features/chat-conversations/chat-features/code-execution/artifacts)).
- Model-emitted custom elements streamed as HTML: no shipped chat product found beyond mdocUI's web-components target. Gemini app Generative UI emits full HTML pages (section 4). Gemini Canvas and ChatGPT Canvas preview model-written HTML/React ([Canvas launch](https://www.androidauthority.com/google-gemini-canvas-launch-3535808)).
- wandb/openui (2024, Chris Van Pelt): prompt to HTML/Tailwind, convert to React/Svelte/Web Components; 22.6k stars, Apache-2.0, pushed 2026-09-25, 209 commits, no releases ([repo](https://github.com/wandb/openui)). Unrelated to Thesys OpenUI; same name.
- vs OpenUI: Markdoc-style tags are the closest relative (text stream, tag registry, prompt from registry) but stay inside Markdown; HTML emitters have no catalog.

## 9. Standards and academic activity

- WebMCP: W3C Web Machine Learning CG Draft Report (2026-10-08), `document.modelContext.registerTool`; pages expose tools to browser agents, not UI ([draft](https://webmachinelearning.github.io/webmcp/)). Chrome trial status varies by source (UNVERIFIED).
- AAIF (Linux Foundation, formed 2025-12-09): MCP, goose, AGENTS.md founding; 8 working groups, none on UI ([press](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation), [aaif.io](https://aaif.io)). A2A reportedly joined Aug 2026 (date UNVERIFIED). AG-UI, A2UI, MCP Apps: no foundation hosting found.
- Papers: "Generative UI: LLMs are Effective UI Generators" (Google, [arXiv 2604.09577](https://generativeui.github.io/)); "Generative Interfaces for Language Models" (Findings of ACL 2026, [SALT-NLP/GenUI](https://github.com/SALT-NLP/GenUI)); A2UI-Bench ([2605.24830](https://papers.cool/arxiv/2605.24830)); EvoGenUI-Bench ([2608.29387](https://arxiv.org/pdf/2608.29387)); LLM-designed GUI evaluation ([2601.22759](https://arxiv.org/abs/2601.22759v1)). No CHI/UIST 2026 paper confirmed. IETF/ISO not searched.

## Comparison table

| System | Model emits | Streaming | Safety | Catalog to model | Reach | Stars / dl-wk | Version, license | Difference from OpenUI |
|---|---|---|---|---|---|---|---|---|
| OpenUI (Thesys) | Line DSL `id = Comp(...)` | Per line, forward refs | Registered components only | Library spec to system prompt; CLI JSON schema | React, Vue, Svelte, Angular; AG-UI, LangChain, assistant-ui, A2UI pkgs | 10.2k / 193k | 0.3.2, MIT | baseline |
| Vercel AI SDK `useChat` | Tool call | Whole part on completion | Fixed tools | JSON Schema of tools | JS frameworks | 27.2k / 34.5M | 7.0.133, Apache-2.0 | 1 component per tool, no composition |
| Vercel `streamUI` RSC | Tool call, server renders React | RSC stream | Fixed tools | JSON Schema | Next.js | same repo / 140k | 3.0.133, experimental | Server-rendered; not recommended |
| json-render | Flat JSON `{root, elements}` or YAML | Patch stream | Fixed catalog | `defineCatalog` Zod to prompt | 10+ renderers incl. RN, PDF, email | 18.6k / 2.35M | 0.21.0, Apache-2.0 | JSON/YAML tree, labs status |
| MCP Apps | Tool call to `ui://` HTML | Partial tool input into static shell | Sandboxed iframe, CSP, permissions | Tool `_meta.ui` | Claude, ChatGPT, VS Code, Cursor, M365, Goose, Postman | 2.9k / 5.3M | 2026-01-26 spec, 2.0.3, MIT to Apache-2.0 | Developer-authored app, not composed UI |
| MCP-UI | Tool result with UI resource | None documented | iframe; legacy remote-dom | Resource types | Goose, LibreChat, MCPJam | 5.2k / 407k | 7.1.1, Apache-2.0 | SDK for MCP Apps |
| OpenAI Apps SDK | Tool call + HTML template | As MCP Apps | iframe + `window.openai` | `_meta` alias | ChatGPT | n/a | MCP Apps aligned | ChatGPT-only extras |
| A2UI | JSONL envelopes, flat components | Per line, placeholders | Declarative data, fixed catalog | JSON Schema catalog in prompt; post-validate | Lit, Angular, Flutter, Markdown; A2A, AG-UI | 16.6k / 527k (lit) | 0.9.1 current, 1.0 RC, Apache-2.0 | JSON Schema catalog, A2A transport |
| Gemini Generative UI | Full HTML/CSS/JS | Not published | Not published | System instructions, tools | Gemini app, AI Mode | n/a | shipped 2025-11 | No catalog, arbitrary code |
| AG-UI | Events | Event stream | Depends on payload | n/a | 10+ frameworks, 8 SDK languages | 16.4k / 2.85M | 1.0.2, MIT | Transport, not format |
| CopilotKit | Tool call (Zod), or A2UI/json-render/MCP Apps payloads | Partial JSON args | Fixed components; iframe for MCP Apps | Zod tool schema | React | 37.8k / 616k | 1.77.2, MIT | Multi-format host |
| LangGraph UI | `push_ui_message(name, props)` | Re-push same id | Developer React, shadow DOM | n/a (agent code picks) | React, Vue, Svelte, Angular | 3.3k / 5.0M (SDK) | MIT | Agent code, not model, chooses |
| assistant-ui | Tool call | UNVERIFIED | Registered tool UIs | UNVERIFIED | React | 12.4k / 2.37M | 0.15.25, MIT | Chat kit |
| Claude Artifacts / Design | Code (HTML, React, docs) | Code stream | Sandbox (details unpublished) | None | claude.ai, Claude Code | n/a | 2026 templates, Design 2026-04 | Arbitrary code |
| C1 (Thesys) | "C1 DSL" JSON | Accumulated string re-render | Fixed Thesys set | Thesys-owned | React | n/a / 10k | 0.10.3, archived | Hosted predecessor |
| mdocUI (Markdoc-style) | Markdown + `{% tag %}` | Per tag, shimmer | Registered components | Zod registry to prompt | React, web components | 40 / n/a | alpha, MIT | Tags inside Markdown |
| wandb/openui | HTML/Tailwind | Live preview | Arbitrary HTML | None | Web | 22.6k / n/a | no releases, Apache-2.0 | Same name, unrelated |

## Where the field is converging (evidence)

- Multiple independent implementers: MCP Apps (11 hosts in the [client matrix](https://modelcontextprotocol.io/extensions/client-matrix); SDKs from MCP, MCP-UI, OpenAI). A2UI (Google Lit/Angular/Flutter renderers; CopilotKit renderer; Macaron bench; [a2ui.org](https://a2ui.org/)). Tool-call-to-component (Vercel, CopilotKit, assistant-ui, LangGraph each independently). OpenUI Lang: one implementer (Thesys) plus its own adapters; Open-JSON-UI: one documenter (CopilotKit).
- Abandoned since 2024: ai-jsx (last push 2024-09-19, [repo](https://github.com/fixie-ai/ai-jsx)); MCP-UI's own resource types superseded by MCP Apps; Thesys C1 archived 2026; `streamUI` RSC frozen at experimental. llm-ui npm unreleased since 2024-06; wandb/openui no releases.
- Big vendors in 2026: Anthropic and OpenAI shipped MCP Apps hosts (Jan 2026); Microsoft (VS Code, M365 Copilot) and Cursor followed. Google moved A2UI to v0.9.1/1.0 RC and shipped HTML-emitting Generative UI in Gemini and Search. Vercel shipped json-render (labs) and AI Elements. Anthropic shipped Claude Design (Apr 2026). None adopted a line DSL.
- Shared pattern across catalog systems (OpenUI, json-render, A2UI, mdocUI): Zod or JSON Schema catalog, generated system prompt, no constrained decoding, client-side validation or repair (OpenUI Autofix, A2UI `VALIDATION_FAILED`).
- Open: whether MCP Apps adds non-HTML declarative renderers (reserved in spec, not scheduled); whether A2UI and json-render interoperate (claimed by secondary sources, UNVERIFIED).

## Not verified

- npm weekly download figures are registry counts; CI and mirror inflation not assessed (json-render 2.35M/week after 9 months, ext-apps 5.3M/week).
- A2UI partners other than CopilotKit; A2A joining AAIF date; A2UI spec release dates.
- Open-JSON-UI as an OpenAI publication; `text/html+skybridge` deprecation notice.
- Claude Artifacts sandbox and emit format; Claude Code as an MCP Apps host; Anthropic first-party AG-UI support.
- C1 DSL syntax; `@thesysai/genui-sdk` license terms; OUI-1 model release.
- assistant-ui streaming and catalog mechanism; json-render patch format; `useChat` partial-argument rendering.
