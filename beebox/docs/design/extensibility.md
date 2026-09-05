# Extensibility — knowledge, not plugins

## The active plan (neither half exists yet)

Extensibility prioritizes understanding over plugin architecture: the primary
mechanism is **giving the agent the knowledge to compose existing pieces** —
concepts, best practices, discovered facts ("AVIF re-encoding halves image
size" becomes part of what the box knows) — plus **small typed artifacts** it
can author: box-local schemas (`config/schemas/`), box skills, box-authored
views. "No plugins" means no registry, marketplace, or lifecycle framework.

Status honestly (ruling 18): this is **actively the plan, and neither part
exists yet** — there is no wiki-style knowledge system, and no plugin system
either. The extension surface that does exist (schemas, skills, views) is the
raw material, not the fulfillment. Empirical support for the no-framework
side: Activities, a built framework for reusable interaction containers, was
removed because the unit of customization that emerged from real use was "a
feature flag plus some prose, not a class hierarchy"
([`../activities-retrospective.md`](../activities-retrospective.md)).

## Composition over new infrastructure

Build new infrastructure only when basic building blocks don't solve the
problem. Want prompted journaling? Compose it (narration behavior + custom
prompts), don't build it. Small additions — a `CLAUDE.md` file with custom
prompts — beat elaborate new structures. Introduce a new building block only
when it unlocks reusable capability across multiple features. The payoff is
familiarity and depth: a piece understood deeply works consistently
everywhere. This also protects against AI-default homogenization: when the
agent builds something unconventional inside the box, it should be a
deliberate choice, not ignorance of the convention.

## "Modes" — concept half-true, not user-facing vocabulary

The old vision named composable interaction modes (Narration Mode, Factual
Mode) plus "chat instructions" as a triage-extension concept. Where that
landed (ruling 19):

- **Modes don't surface to users**, and nothing in the system is called a
  mode. Narration shipped as three features plus a system-prompt overlay;
  the mode-container framework (Activities) was removed.
- The concept is **half-true as a design instinct** — mode-shaped ideas keep
  arriving (e.g. a Listening Mode idea the boxholder likes) and ship as
  composed features, which is the intended path.
- **"Chat instructions"** as a named concept appears nowhere in code; its job
  is done by rules/personality prose and triage category rules.
