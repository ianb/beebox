---
title: "A loop that pulls the concrete rules toward the idealized ones: state the ideal, find where the code falls short, turn the gap into a rule"
workstream: unattached
needs: [design]
area: beebox
labels: [craft, principles]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "the idea of specifying the ideal craft of the code and system… then we look around and see if there's something that doesn't live up to that"
priority: normal
---

The boxholder's framing: *"The idea of specifying the ideal craft of the code
and system. Very principled, not very specific. Then we look around and see if
there's something that doesn't live up to that. This turns into an issue to
review, and then into some concrete rules or something. The idea is to make the
concrete principles slowly more in line with the idealized principles, and to
improve things bit by bit. This should probably do research pretty freely when
considering (e.g., the answer might be: we should use this library or
pattern)."*

So: a repeating loop, **ideal → gap → issue → rule**, where each turn moves the
enforceable layer a little closer to the aspirational one.

## Half of this already exists, which is why the gap is narrow and worth naming

[`docs/engineering-principles.md`](../../beebox/docs/engineering-principles.md)
already holds the idealized layer: thirteen principles, explicitly *above* the
mechanical rules — its own words, *"`code-style.md` says how to write a line,
the principles say why the shape of the code is what it is"*. And principle 11
(*Enforcement beats convention, and the preset is ours*) already asserts the
direction of travel this loop would institutionalize: a recurring legitimate
rule gets encoded into `@ianbicking/personal-vibe-check` rather than repeated
in prose.

What is missing is the **pass that compares the codebase against the ideals**
and the path from a finding to an enforceable rule. Today a principle is applied
when someone happens to be reading the relevant code; nothing sweeps for where
the code and the stated ideal have diverged, and nothing routes a repeated
finding into the preset.

Small evidence that nothing re-reads this document against itself: it said
*"Twelve principles"* while carrying **thirteen** `## N.` headings — a
thirteenth was added and the sentence above it was not. Corrected when this
issue was filed; recorded here because the interesting part is that the drift
survived until someone read the file for an unrelated reason.

## The design work this needs first — which is the boxholder's stated reason for filing

Not "write a skill". The questions that decide whether the loop produces
anything worth reading:

- **What makes a good idealized principle?** The existing thirteen are strong
  because each one names a failure it prevents and cites where that failure
  actually happened. A principle that cannot be violated by real code is
  decoration. Does this loop *extend* that document, or does it need a different
  register above it — "the ideal craft of the system" may be larger than
  engineering principles (what a box feels like to own, what an agent can
  understand) and those may not belong in the same file.
- **How is a gap found without becoming a whole-codebase audit?** Thirteen
  principles × a large codebase is unbounded. One principle per pass against one
  area is a candidate shape; so is "start from a recent change". Whatever is
  chosen has to produce a short, specific finding, not a survey.
- **What is the output, exactly?** The boxholder says "an issue to review, then
  concrete rules". The rule end has three real forms here: a lint rule in the
  preset, a line in `code-style.md`, or a knowledge audit
  ([`docs/knowledge-audits.md`](../../beebox/docs/knowledge-audits.md)) when the
  thing to hold is agent recall rather than syntax. Choosing among them is part
  of the finding, and "no rule, just fix it" must stay a legal outcome.
- **The research licence.** The boxholder explicitly wants this to research
  freely — the answer may be *adopt this library* or *this is a known pattern
  with a name*. That is unusual for a sweep and should be stated in whatever
  runs it, or it will default to local tinkering.
- **Cadence and ownership.** The repo's sweeps are weekly schedules with an
  alert surface (`knip-sweep`, `supplemental-lint`, `tour-check`,
  `smoke-review`). This may fit that mould — or may be too judgment-heavy to run
  unattended, in which case it is a skill the boxholder invokes. Compare
  [`bbx-codehealth`](../../.claude/skills/bbx-codehealth/SKILL.md), which is
  already the invoked-deliberately shape.

## Related

- `2026-09-14-what-can-we-remove-sweep.md` — the sibling idea, filed together.
  They share the "principled sweep with a design gap" shape and should probably
  be designed together, but they look for opposite things: this one finds code
  that falls short of an ideal, that one finds code that should not exist.
- [`bbx-codehealth`](../../.claude/skills/bbx-codehealth/SKILL.md) already
  hunts shallow modules and cruft against a stated aim. The overlap is real and
  the design should say whether this is a new practice or a second lens inside
  that one.
