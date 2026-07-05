# /design-consultation — design system from scratch

Six-phase conversation that ends with a written DESIGN.md and a CLAUDE.md update telling the agent to always read it. The skill walks: pre-checks → product context (with memorable-thing forcing question) → optional competitive research → complete proposal with SAFE/RISK breakdown → optional drill-downs → visual preview (AI mockups or HTML) → write DESIGN.md.

Like design-shotgun, the heavy infrastructure (`$D` image binary, `$B` browse daemon, taste-profile store) makes wholesale adoption costly. But there are some genuinely sharp ideas — one of which is among the best things in all of gstack.

## ★★★ The SAFE / RISK split (the headline idea)

The complete proposal explicitly separates two kinds of decisions:

```
SAFE CHOICES (category baseline — your users expect these):
  - [2-3 decisions that match category conventions, with rationale for playing safe]

RISKS (where your product gets its own face):
  - [2-3 deliberate departures from convention]
  - For each risk: what it is, why it works, what you gain, what it costs

The safe choices keep you literate in your category. The risks are where
your product becomes memorable.
```

The framing:
> "Design coherence is table stakes — every product in a category can be coherent and still look identical. The real question is: where do you take creative risks?"

**This generalizes far beyond design.** Any "pick a direction" decision benefits from explicit SAFE/RISK separation:

- Architecture: "We're SAFE on auth (off-the-shelf JWT, everyone expects it). We're taking a RISK on the storage layer (custom append-only log instead of standard ORM — pays off in [X], costs [Y])."
- Product positioning: "SAFE: we look and feel like a typical developer tool. RISK: we lead with the long-running-task story which most competitors bury."
- Code review options: same finding might have a safe fix and a risky-but-better fix; the framing makes that explicit instead of presenting them as equivalent.

The discipline forces the agent to propose AT LEAST 2 deliberate departures *with rationale* — what you gain AND what you give up. No risk-free decisions, no risk-without-justification.

★ Probably the single most portable idea in gstack. Worth a CLAUDE.md note or its own principle in `engineering-principles.md` when written.

## ★★★ The memorable-thing forcing question

Before any design work begins:

> "What's the one thing you want someone to remember after they see this product for the first time?"
>
> One sentence answer. Could be a feeling, a visual, a claim, or a posture. Write it down. Every subsequent design decision should serve this memorable thing. Design that tries to be memorable for everything is memorable for nothing.

**Generalizes to any product or feature framing.** The question forces a single answer, which is the constraint. "Design that tries to be memorable for everything is memorable for nothing" is quotable — applies equally to docs, pitches, READMEs, feature scope.

Pairs naturally with the SAFE/RISK split: the memorable-thing tells you *what to take the risk on.* Everything else can be safe.

## ★★ "Design consultant, not form wizard" posture

Top of the skill:
> "You are a senior product designer with strong opinions about typography, color, and visual systems. **You don't present menus — you listen, think, research, and propose.** You're opinionated but not dogmatic. You explain your reasoning and welcome pushback."
>
> "**Your posture:** Design consultant, not form wizard."

Anti-pattern named: AI presents 50 options and asks the user to pick. Replacement: AI proposes a coherent direction, explains why, invites pushback.

**Generalizes to almost any AI-assisted decision.** When the user asks for help, default to *"here's what I think we should do and why"* rather than *"here are 7 options, which do you want?"* The latter shifts the work back to the user instead of doing the synthesis the user came for.

This is also consistent with what you've already articulated: prefer prose reasoning to presenting choices unweighted.

## ★★ Self-gate before showing AI output to the user

Phase 5 quality discipline:
> "For each variant, ask yourself: *'Would a human designer be embarrassed to put their name on this?'* If yes, discard and regenerate. **This is a hard gate. A mediocre AI mockup is worse than no mockup.**"

Embarrassment triggers are named explicitly: purple gradient hero, 3-column SaaS grid, centered-everything, Inter body text, generic stock-photo vibe, system-ui font, gradient CTA button, bubble-radius everything.

**The general principle is huge.** Before presenting AI output to the user, run a competence check: *"Would a competent human be embarrassed to put their name on this?"* If yes, discard and regenerate (or escalate). Generalizes to AI-generated code, writing, designs, recommendations — anywhere the model can produce technically-correct-but-slop output.

## ★★ Named convergence traps and slop anti-patterns

Two related lists embedded in the prompt:

**Font blacklist** — never recommend: Papyrus, Comic Sans, Lobster, Impact, Jokerman, ..., **Inter, Roboto, Arial, Helvetica, Open Sans, Lato, Montserrat, Poppins, Space Grotesk** (the last group is "overused, only use if user asks by name").

The Space Grotesk note is the most interesting:
> "Space Grotesk is on the list specifically because **every AI design tool converges on it as 'the safe alternative to Inter.'** That's the convergence trap. Treat it the same as Inter: only use if the user asks for it by name."

**AI slop anti-patterns** — never include: purple/violet gradients as default accent, 3-column feature grid with icons in colored circles, centered-everything uniform spacing, uniform bubbly border-radius, gradient buttons as primary CTA, generic stock-photo hero, system-ui as primary display font, "Built for X / Designed for Y" copy.

**The meta-pattern is the keeper.** Domain doesn't matter — what matters is: **explicitly name the convergence traps the AI defaults into, and forbid them.** Equivalent lists could exist for code patterns (the "every AI suggests a custom hook for this" trap), writing patterns (the "Let me unpack that" trap — already in MEMORY.md), product naming (the "AI-suggests-a-pun" trap). When AI converges on a "safe" choice, that very safety becomes a tell.

## ★ DESIGN.md output structure (template)

Thorough form-as-prompt for a design system doc — Product Context, Aesthetic Direction, Typography (display/body/UI/data/code/loading/scale), Color (primary/secondary/neutrals/semantic/dark), Spacing, Layout, Motion, Decisions Log.

If callback ever wants a design system doc, this is a solid starting structure. The Decisions Log table at the end is the part most relevant beyond design — *"record what was decided, when, and why"* applies to any system-level choices.

## ★ Updates CLAUDE.md with reference rule

After writing DESIGN.md, the skill appends to CLAUDE.md:
> "Always read DESIGN.md before making any visual or UI decisions. All font choices, colors, spacing, and aesthetic direction are defined there. Do not deviate without explicit user approval. In QA mode, flag any code that doesn't match DESIGN.md."

**Pattern: when you create a authoritative doc, update CLAUDE.md to tell the agent to always read it before relevant work.** Otherwise the doc is invisible to the agent during the work it was supposed to inform.

Worth borrowing whenever we add a callback principles/design/architecture doc.

## Other notable bits

- **Coherence Validation when user overrides one section** — flag mismatches with a gentle nudge, never block. "Brutalist aesthetic + expressive motion → heads up, brutalist usually pairs with minimal motion. Your combo is unusual — which is fine if intentional. Want me to suggest motion that fits, or keep it?" Always accept user's final choice. Reads as: AI flags inconsistency without overriding user judgment.
- **Anti-convergence across generations**: "Across multiple generations in the same project, VARY light/dark, fonts, and aesthetic directions. Never propose the same choices twice without explicit justification. Convergence across generations is slop." Same theme as design-shotgun's anti-convergence directive.
- **Taste memory** with decay-on-read — already covered in design-shotgun notes.
- **Phase 6 plan-mode behavior**: when in plan mode, write the DESIGN.md content into the plan file as a "## Proposed DESIGN.md" section; don't write the actual file until implementation. Clean separation of "decided" from "applied."

## Ian's take

(to be filled in)

## Adoption candidates (ranked)

★★★ **High value, broad applicability — adopt as principles:**

1. **SAFE / RISK split** — the single most portable idea. Add to engineering-principles doc when written, or as a CLAUDE.md instruction: *"When proposing a direction with multiple decisions, separate SAFE choices (category baseline, why we conform) from RISKS (where we deliberately diverge, what we gain, what we give up). At least 2 RISKS, each justified."*
2. **Memorable-thing forcing question** — generic framing question for any product/feature scope work. "What's the one thing you want someone to remember after they see this for the first time?"
3. **Design consultant, not form wizard** posture — generalize to any AI-assisted decision. Propose with reasoning, invite pushback. Don't dump menus.
4. **Self-gate: would a competent human be embarrassed?** — quality check before presenting AI output.
5. **Name the convergence traps** — meta-pattern of identifying and forbidding what the AI defaults to "safely." Domain-specific lists (code patterns, writing patterns, naming patterns) over time.

★★ **Worth borrowing situationally:**

6. **CLAUDE.md reference rule** when adding any authoritative doc: tell the agent "always read X before doing Y."
7. **DESIGN.md template** if callback ever needs a design system doc.
8. **Coherence-flag-without-blocking** posture: surface inconsistencies, never override user.

★ **Park / skip:**

- The 6-phase consultation flow itself — too heavy for current needs.
- Taste-profile / `$D` mockup infrastructure — same conclusion as design-shotgun.
- The 10 named aesthetic directions, font lists — useful reference material if needed, not worth pre-loading.
