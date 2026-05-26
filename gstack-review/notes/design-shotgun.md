# /design-shotgun — visual design variant exploration

Generates N visually distinct design mockups for a screen, opens them side-by-side in a real browser comparison board, lets the user rate/comment/remix/pick, iterates on feedback, and persists the chosen direction plus taste signals for future sessions.

The infrastructure is heavy (requires a `$D` design binary that wraps an image-generation API, a `$B` browse daemon, an HTTP comparison board server, a `gstack-taste-update` CLI for the persistent taste profile). Same conclusion as scrape/skillify and pair-agent: the mechanics are great, the infrastructure isn't portable. But a handful of the mechanics are gold regardless of whether we ever adopt the skill.

## The five ideas worth keeping (regardless of skill adoption)

### ★★★ 1. Concept-before-image generation

Before spending expensive image-generation API credits, generate N **text concepts** describing each variant's design direction, present them as a lettered list, and confirm with the user:

```
I'll explore 3 directions:

A) "Name" — one-line visual description
B) "Name" — one-line visual description
C) "Name" — one-line visual description
```

Then AskUserQuestion: A) all three look good, B) change some, C) add more, D) drop some. Only after confirmation does it spend credits on actual generation.

**Generalizes way beyond design.** Any time an AI task is expensive (image generation, large code generation, deep research, long writing), generate cheap *candidates* first — outlines, function signatures + approach, research questions + plan — confirm direction with the user, then commit the expensive token budget. **Pre-commitment to direction before spending.** Avoids the "wait, that's not what I wanted, regenerate it all" loop.

### ★★★ 2. Anti-convergence directive

When asked for N options, the model's default failure mode is to produce N "different" things that are minor permutations of the same idea. The skill fights this with an operational test:

> **Hard requirement:** Each variant MUST use a different font family, color palette, and layout approach. If two variants look like siblings — same typographic feel, overlapping color temperature, comparable layout rhythm — one of them failed.
>
> **Concrete test: if someone could swap the headline text between two variants without noticing, they're too similar.** Variants should feel like they came from three different design teams, not the same team at three different coffee levels.

**Generalizes to any "give me N options" task.** The swap test is the gem — it makes "are these actually different" auditable instead of vibes-based. Examples:
- N fix options for a bug → could you swap the file:line between them without changing meaning?
- N product positioning angles → could you swap the audience without breaking the pitch?
- N test names for the same concept → could you swap one name into another's body?

When the answer is yes, that variant collapsed; regenerate with deliberate divergence.

### ★★★ 3. Anti-shortcut rule with named failure mode

> **Why /tmp/ then cp?** In observed sessions, `$D generate --output ~/.gstack/...` failed with "The operation was aborted" while `--output /tmp/...` succeeded. This is a sandbox restriction. Always generate to /tmp/ first, then cp.

Same pattern as plan-eng-review's "May 2026 transcript bug" rule. State the rule, name the specific observed failure, explain why. Makes the rule durable instead of mysterious. **Worth adopting as a general format for any debugging-derived rule we write.**

### ★★ 4. Pre-fill from inferred context, then ask for gaps

> "Pre-fill what you inferred from the codebase, DESIGN.md, and office-hours output. Then ask for what's missing. Frame as ONE question covering all gaps."

Two-rounds-max cap on context-gathering, then "proceed with what you have and note assumptions."

Basic good practice but worth codifying as a rule: **don't ask the user what you could find out from the code/files/recent context. Bundle remaining gaps into one question, not a chain.** Already aligned with how the existing CLAUDE.md guidance talks about clarifying questions (spend a minute on read-only investigation first).

### ★★ 5. Tool-boundary discipline

> "**Do NOT use AskUserQuestion to ask which variant the user prefers. The comparison board IS the chooser.** AskUserQuestion is just the blocking wait mechanism."

Subtle but right. When you have two tools that could do the same job, pick the one that fits the semantics. AskUserQuestion is for decision briefs with structured options; a rendered comparison board is for visual selection. Don't collapse them into the wrong one.

## Other notable mechanics

**Taste Memory**: persistent JSON profile (`taste-profile.json`) across sessions tracking dimensions (fonts/colors/layouts/aesthetics) with approved[]/rejected[] entries, confidence + counts + last_seen. **Confidence decays 5%/week of inactivity, computed at read time** (file only grows on change). Conflict flagging: when current request contradicts strong stored preference, surface it: *"your profile strongly prefers minimal, you're asking for playful — proceed, but want to update the profile or treat as one-off?"*

Interesting concept but probably overkill for callback. Worth noting the decay-at-read pattern — it's a clean way to keep a long-running preference store from getting stale without nightly rebuilds.

**UX Principles library** (Step 0 prelude): "Three Laws of Usability" (don't make me think, clicks don't matter thinking does, omit then omit again), "How Users Actually Behave" (scan don't read, satisfice, muddle through, don't read instructions), "Billboard Design", "Goodwill Reservoir", "Mobile: Same Rules Higher Stakes". Mostly distilled from Krug's *Don't Make Me Think.*

Same caveat as plan-eng-review's Cognitive Patterns — could read as superstition if presented as monolithic wisdom. Krug's stuff is more validated than most eng-management folklore though. Reference if useful, don't pre-load.

**Quality check after generation**: each variant subagent runs `$D check --image ... --brief "..."` post-generation, a vision quality gate. Retry once if fails. Could matter for any "AI generates artifact" workflow — automated quality gate before presenting to user.

**"I don't like THIS" evolve path**: detects a running local site, screenshots it, uses `$D evolve` to generate improvement variants from the existing design. Handles the "this looks bad, fix it" workflow as a first-class case rather than treating it identically to "design something new."

**Parallel subagent generation**: N Agent tool calls in a single message, each agent independently generates → quality check → verify → retry → report. Same parallel-subagent pattern from the review specialists in /review.

## Ian's take

(to be filled in)

## Adoption candidates

In order of value:

1. **Concept-before-image generation** as a general principle — generalize to any expensive AI generation task. Could become a CLAUDE.md instruction: *"For expensive multi-option AI work, propose options as cheap descriptors and get confirmation before generating."*
2. **Anti-convergence swap-test** for any "give me N options" task. Quote in CLAUDE.md or in a future engineering-principles doc.
3. **Anti-shortcut rules with named failure modes** — adopt as a format whenever we write a "rule because of X" in CLAUDE.md or skill docs.
4. **Pre-fill-then-ask** for clarifying questions — already aligned with existing guidance, worth codifying.
5. Tool-boundary discipline — too situational to codify, but good to know.

design-shotgun itself as a skill — probably skip for callback. callback is a developer tool; visual design exploration is rarely the bottleneck.
