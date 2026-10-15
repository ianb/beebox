# "Could this be simpler?" as skill prose, then as a template field
## Supporting: the Aug 26 shrink (4b7d18f65)
- The gate kept its teeth; the words moved to where they are read once

```text
SKILL PROSE (before)
The mandatory complexity challenge. With the tracks sketched, state the
**simplest version that could plausibly work** — a cruder, smaller, or more
partial approach, even one you don't intend to ship — then say, concretely,
what the plan's fuller approach buys over it, traced to a stated preference…
If you can't name what the extra complexity buys, that IS the finding: shrink
the plan toward the simple version.

TEMPLATE FIELD (after)
## Could this be simpler?
<!-- A gate, not a section. State the simplest version that could plausibly
     work… then what the fuller plan buys, traced to a principle… If you can't
     name what the complexity buys, shrink the plan. Usual over-builds: a new
     abstraction where a caller arg would do, a daemon where a one-shot would
     do, defence against a failure that can't happen, a generalization with
     one caller. -->
```

Notes:
Commit body: "The template body moves to TEMPLATE.md beside the skill, read once when a plan is written instead of on every invocation; section guidance travels as comments inside it."
