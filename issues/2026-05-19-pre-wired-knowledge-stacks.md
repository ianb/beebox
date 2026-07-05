---
needs: [design]
area: callback-box
---

# Pre-wired knowledge stacks per project / relationship

The agent currently mostly wings it on domain reasoning — uses general training plus what's in the box. For recurring contexts (an active project the boxholder works on repeatedly, a key relationship) it could be more useful by drawing on canonical references: 2–3 sources whose frameworks apply directly to that project or person. The frameworks load automatically when the context is active, so application becomes reflexive rather than improvised.

Distinct from the [Canonical wisdom corpus (in lieu of plugins)](2026-05-11-canonical-wisdom-corpus.md) entry: that's about *how to structure things in the box* (book-tracking patterns). This is about *domain frameworks for the things in the box* (negotiation lens for a vendor relationship, communication framework for a family member, methodology for a project).

The real risk: pre-wiring makes application reflexive, and *reflexive misuse* is the dangerous failure mode. A framework that doesn't fit the situation, applied confidently because it was pre-wired, is worse than the agent winging it from observation. The boxholder's sister wired to attachment-theory frameworks that don't actually fit produces confident wrongness the agent wouldn't otherwise reach.

Design tension: pre-wiring trades accuracy-from-observation for speed-of-application. Probably useful for domains where frameworks are mature and broadly applicable (negotiation, basic communication styles, project-management methodologies). Probably risky for contested or person-specific domains (psychology, family dynamics, anything where fit is the whole question).

Open questions:
- **Who picks the canon?** Boxholder explicit choice, agent proposes for confirmation, or shared corpus the boxholder opts into?
- **How is the binding represented?** Per-project frontmatter, a wiring file, tags on person cards?
- **How does the agent know when to apply vs. set aside?** A wired framework that observation contradicts should defer to observation — needs an explicit precedence rule.
- **Discoverability for the boxholder.** They should be able to see "the agent is reasoning about Alice through framework X" and override.
- **Connection to [Hypothesis tracking](2026-05-19-hypothesis-tracking.md) and [Universal confidence rubric](2026-05-19-universal-confidence-rubric.md)** — framework-derived conclusions are inferences, not facts, and should carry the appropriate confidence band.
