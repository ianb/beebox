---
title: "chat output vocabulary ia pass"
needs: [design]
area: callback-box
---

Triggered by adding `{% redacted %}` — there was no obvious place to document it for the chat agent. Looked into existing patterns and the categorization isn't clean. The chat agent's emit-side vocabulary currently splits along several un-aligned axes:

- **Display-side affordances** — `<callout>`, `<ack>`, `{% redacted %}`. How content is *shown*, independent of what it is. `<callout>` / `<ack>` are in the system prompt (core); `redacted` isn't.
- **Content-typed tags** — `{% quote %}`, `{% source %}`. Mark *what kind of thing* a span is. Probably should be in the prompt at some baseline level (an agent that doesn't reach for `{% quote %}` will write quotes flat); currently not mentioned.
- **Domain vocabularies** — recipe (`{% ingredient %}`, `{% step %}`), briefing (`{% purpose %}`, `{% key-person %}`). Only relevant when authoring that doc type; should be loaded by `paths:` rule when editing matching cards, not in chat prompt at all.
- **Protocol tags** — `<chat-app>`, `<schedule>`, `<cancel-schedule>`, `<speech>`. Already in prompt; not really "output formatting" — they're the control surface.
- **Voice overrides** — already gets its own on-demand doc (`docs/generated/chat-voice.md`).

Open questions the IA pass needs to answer:

- **What's "core enough to be in the prompt every turn"?** Probably `<ack>`, `<callout>`, `<speech>`, `<schedule>`, `<chat-app>` (already in). Probably also `{% quote %}` (so it gets used). `{% redacted %}` is borderline — niche enough to live in a reference doc, but the agent won't reach for it if it doesn't know it exists.
- **One reference doc or several?** A monolithic `chat-output.md` reads top-to-bottom but inflates loading cost when only one piece is needed. Per-tag docs scale better but the agent has to know to look. The narration-mode pattern (one doc per situation) doesn't map cleanly to vocabulary.
- **How does the agent discover what to reach for?** A vocabulary the agent doesn't know about is invisible — same problem as the [Capability map for the boxholder agent](../exploration/2026-05-19-capability-map.md) entry. Possibly the answer is the same: a single browsable index of "ways to shape your output," consulted opportunistically.
- **Where do tags that span surfaces live?** `{% quote %}` matters in chat *and* in briefings *and* in memos. Per-surface docs duplicate; one shared doc gets re-loaded in contexts where most of it is irrelevant.
- **How does this interact with [Capability map for the boxholder agent](../exploration/2026-05-19-capability-map.md)?** Both are "things the agent could do but might not know to reach for." Probably want one IA pass that produces a coherent answer for both, rather than two parallel solutions.

**The doc-length asymmetry.** *Listing* the vocabulary is short — a single page could enumerate every tag with one-line semantics. What balloons the doc is **selection criteria**: when to reach for `{% quote %}` vs. a plain blockquote, when `<callout>` vs. inline prose, when multi-speaker `<speech diarized>` vs. single voice. Any feature powerful enough to be misused needs that guidance or it goes feral (agent uses it everywhere, or never, or in the wrong situations). So the rule of thumb for keeping the doc compact is: tags with obvious, low-stakes usage can be one line; tags whose value depends on judgment need the judgment written down, which is where pages come from. Implication: when adding a feature, ask "does this need selection criteria?" — if yes, budget for the doc cost upfront; if it's purely additive and hard to misuse (like `redacted`), one line suffices.

For now: `{% redacted %}` is implemented and discoverable via `src/shared/markdoc-config.ts`, but not in any agent-loaded doc. Decision deferred to the IA pass.
