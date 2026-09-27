# The prompt surface

Everything an agent is told about Bee Box before it acts: the agent guide,
the chat and reactor system prompts, schema instructions, box skills, and
rules. All of it is generated code (`src/core/agent-guide/`,
`src/core/chat/session/prompts.ts`, `src/core/reactor/prompts.ts`, schema
`instructions`, `src/core/box/guidance-sync/skills-content.ts`), assembled into a
per-situation context stack. One page per member.

## Members

| Member | What it covers |
|---|---|
| [Review](prompts/review.md) | Rendering the assembled stack, the layering model, the structural rules, the review pass in order, and the session-cache invariants. |
| [Lenses](prompts/lenses.md) | The catalog a review pass hunts with: compactness, rules versus defaults, citation form, delegation, response weight, and the data-design lenses beside them. |
| [Logging](prompts/logging.md) | Capturing what an agent was actually sent: `BBX_LOG_PROMPTS`, the DOCID markers that confirm which generated docs reached it, session JSONL, correlating a session's artifacts. |

## Owned elsewhere

- Routing one new instruction to the right box surface: the `bbx-context` skill.
- Testing what a box agent retained: [knowledge audits](testing/knowledge-audits.md).
- Which engine and model a box thinks with: [model policy](model-policy.md).
- The agent guide's section registry, the box-side analogue of "one home per fact": `src/core/agent-guide/sections.ts`.
