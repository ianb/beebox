# The budget caught main once
## Supporting: an agent-filed issue, Oct 2
```markdown
title: "The rendered agent guide is over its word budget on main"
filed-by: agent
discovered-in: markdown-expressiveness

`pnpm lint:guide --box <test clone> --report` fails on main: the rendered
guide is 5705 words against `budget.guide_words` 5595, and always-loaded
context is 10667 words against `budget.always_loaded_words` 10213. The
overrun predates the markdown-expressiveness change, which adds 11 words.

Either trim the guide back under the ceilings or raise them with a recorded
reason in `src/core/agent-guide/ledger.yaml`, as earlier raises did.
```
- The agent that hit the ceiling filed the issue rather than raising the number
- Compare the dev side: the root CLAUDE.md regrew 850 → 1,277 words in the same four weeks with nothing to push back

Notes:
Measured today on a bare box: 5,555 guide words, 10,289 always loaded, under budget. The regrowth example on the dev side is slide 04c.
