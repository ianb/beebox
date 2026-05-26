---
name: feedback-no-premature-tuning
description: "Soft default — prefer waiting until specific AI behaviors cause real friction before adding rules to fix them; derived from one observation, not strongly endorsed"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6f088193-eb30-436c-80cb-1b6a986f9034
---

**Provenance note:** Derived from one observation, not an explicit broad endorsement. Ian declined to read gstack's opus-4-7 model overlay (a list of per-model behavioral nudges) with the reasoning *"I'll do it eventually, but not sure what problems it will expose, want to encounter them before I try to fix them."* I generalized that to a principle. When this came up again later, Ian said *"I don't know exactly where that comes from. I'm not against that necessarily."* So this stands as a soft default — apply with light touch, not a firm rule.

**Soft default:** When suggesting AI behavior tuning — model overlays, prompt nudges, abstract "do/don't" lists — prefer waiting until a specific behavior causes real friction in practice before proposing the rule that fixes it. Don't pre-load fix lists for hypothetical problems.

**Why this soft default makes sense:** A rule written for an abstract failure mode often targets behaviors the user hasn't encountered. Adding it costs context, may distort behavior in ways that don't match the actual environment, and obscures which rules are central vs. cargo-culted. Encountering a problem first makes the fix targeted and the rule durable.

**How to apply:**
- When recommending behavioral rules, prompt additions, model overlays, or do/don't lists: don't push proactively unless the user has reported the specific friction the rule fixes.
- If suggesting one, name the concrete behavior it addresses — not just "this is a common AI failure mode."
- When the user encounters a real annoyance, that's the moment to add a targeted rule (and save it as feedback if recurring).
- Existing feedback memories all came from specific encountered friction — that's the bar. New rules should clear it.
- If the user wants to add a rule proactively (their call, not yours), honor it.
