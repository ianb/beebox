---
name: bbx-design
description: Write or review the product design for work that changes what a person experiences of the box - a new or changed card type, a surface or view, a proactive behavior, a notification or check-in, chat behavior, onboarding, or a record a person reads. bbx-plan hands off to it before the tracks. Not for bugs, refactors, infrastructure, or dev tooling.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# bbx-design

The product-design counterpart of bbx-plan. A plan says how the code changes;
a design says what a person meets, when, and where. Use it when work changes
what a person experiences of the box, including anything the box does on its
own; skip it for bugs, refactors, infrastructure, and dev tooling. Write it
before the plan's tracks, which then build it.

## Read first

`beebox/docs/architecture/spirit.md`, all of it. Design serves it: "If
something in the architecture contradicts what's written here, the
architecture is wrong." `beebox/docs/design/` says why the system has its
current shape; `interaction-model.md` and `trust.md` matter most here.
Name people from `beebox/docs/example-names.md`.

## Writing it

Copy `TEMPLATE.md` (beside this file). Standalone, it is the subplan
`beebox/docs/plans/<topic>.design.md`, with plan frontmatter, linked from the
parent plan's `## Design` section; both ship together. Inline, paste its
sections under that heading one level down. Then, in order:

1. **Situations.** "When [situation], I want to [motivation], so I can
   [outcome]." Several, concrete and mundane, about a kind of person in a real
   moment: spirit.md's Diana in the car at 5:45am, not "a user manages tasks."
   Include one where the person does not want this. If no situation comes,
   the work may not be user-facing; say so.
2. **Right place, right time.** Per situation: is this the moment the box
   should act, show, or stay quiet? Where does it appear: which surface, which
   card, which tier of attention (interrupts, waits to be found, background)?
   Quiet and findable is the default; an interruption needs a reason the
   person would give.
3. **Spirit.** Name the spirit.md section the design serves and the one it
   risks: feel like a place; see the gears; feedback is not all commands;
   playful; the best stuff comes from people; messy is fine; not broken
   versions of better selves; feel possible.
4. **Trust.** Per `design/trust.md`: does each action start as question,
   confirmation, or automatic, and what answer moves it a rung?
5. **Wrong or nothing.** What the person sees when input is messy, the guess
   is wrong, a step fails, or there is nothing to do. Can they see why, and
   correct it in their own words?

Walk one situation hop by hop against the real surfaces, as bbx-plan's
scenario walk does. Keep it to a page.

## Reviewing

Findings: situations about "the user" with no moment; the mechanism described
before the situation; no quiet case; a spirit risk named with no guard; an
automatic action with no rung below it; failure shown as silence.
