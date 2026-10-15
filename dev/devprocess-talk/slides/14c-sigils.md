# A prose rule, then a refusal
## Supporting: the sigil rule, Sep 20 → Oct 7
- A briefing that said "land on main only through `$finish` when they ask" made the receiving session run finish on its first turn

```text
THE RULE (69875694f, Sep 20, in the launch skill)
**Never write a bare `$skill` or `/skill` in briefing prose.** Both are
invocation syntax, and the receiving agent runs them. A Codex session briefed
with "land on main only through `$finish` when they ask" invoked `$finish` on
its first turn, before reading anything (2026-09-20).

MEASURED (Oct 7): 83 later sessions did it anyway.

THE REFUSAL (bin/briefing-sigils.ts, Oct 7)
        echo "$command_name: refusing: the briefing invokes a skill by sigil:"
        echo "A sigil is invocation syntax and the receiving agent runs it."
        echo "Name the skill without a sigil: 'use the finish skill'."
        echo "Code spans and fenced blocks are exempt; --allow-sigils overrides."
```
- Same shape elsewhere: a hand-kept Codex copy → a generator; stale paths in docs → doc-check validates backticked paths (85 fixed at once); flake discretion → a scripted single rerun

Notes:
The refusal fails closed: if no skills can be read, an empty skill list would pass every briefing, so that is exit 2.
