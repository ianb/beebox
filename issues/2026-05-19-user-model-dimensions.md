---
needs: [design]
area: callback-box
---

# User-model dimensions

Related to the memory-writing guidance above: a deep model of the principal (boxholder) is something that *develops over time* from observed interactions, not something written upfront. But for accumulation to add up to a model rather than a pile of facts, the agent needs scaffolding of *which dimensions to pay attention to*. Candidates:

- Decision style — data-driven vs. intuitive; wants alternatives with tradeoffs vs. wants a single recommendation
- Tolerance for ambiguity — comfortable with "it depends" vs. wants a concrete call
- Pushback preference — wants the agent to challenge vs. wants the agent to execute
- Communication style — terse vs. expansive; clinical vs. warm
- When to recommend vs. when to enumerate
- What kinds of errors are tolerable vs. costly

The static part of the system isn't the principal's content; it's the *axes* the system watches for evidence along. Boxholder-specific: harder than the coding-assistant case because the boxholder may not articulate preferences directly — the agent has to infer from how conversations land.
