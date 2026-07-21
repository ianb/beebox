---
title: "Agent writes a bare `Foo.type.card` filename in chat instead of a link"
area: callback-box
filed-by: agent
discovered-in: main session — a box produced `name_of_card.gdoc.card` in a chat response
---

A box wrote a bare `name_of_card.gdoc.card` as literal text in a chat reply,
instead of a markdown link the user could click. Boxholder reports it as a
**persistent** problem, not a one-off. Investigated; **no prompt changes made
yet** (deliberately — the framing wants a decision first).

## Where the behavior comes from (prompt-surface audit)

**The rule is positive-only, stated once, and never framed as a prohibition.**
The only instruction is the chat prompt (`src/core/chat/session/prompts.ts:82`):

> **Links.** Reference a file or card by its plain box path —
> `[the plan](/store/notes/Plan.doc.card)`. … Reach for a link instead of
> re-describing a file in prose.

Nothing anywhere says the inverse — *a bare `Foo.type.card` token in a response
is wrong; always wrap it in a link.* The agent has an example to follow but no
failure mode to avoid.

**The bare-filename form dominates the surface it's mimicking.** Bare
`Foo.type.card` strings appear in agent-facing prose at ~15 sites — the cards
guide, laws, source, and the schema `instructions` (`gsheet.tsx` `Budget.gsheet.card`,
`recipe.tsx`, `landmark.ts`, and `gdoc.tsx`). All are legitimate (naming a card
*type*, or a directory listing), but they model referring to a card by bare
filename in prose, and there are many of them against one "link it" line. The
model follows the dominant pattern.

**gdoc is the most exposed type.** `src/schemas/gdoc.tsx` instructions say
*"Each synced Google Doc has a `.gdoc.card` … Not to be confused with
`.doc.card`"* and show `store/drive/Project_Notes.gdoc.card` — bare, in the exact
material the agent reads while working with a gdoc. Its nearest example when it
wants to reference the gdoc it just synced is the bare form.

**The link rule is chat-only.** `prompts.ts` is the chat session prompt; a
batch/reactor or scheduled agent doesn't get "reach for a link instead of
re-describing." (This instance was chat, so that's not the cause here — but it
means non-chat surfaces have *no* linking guidance at all.)

## Fix directions (do not apply yet — pick during triage)

- **Name the failure, not just the fix.** Add a one-line prohibition next to the
  positive rule: a bare `Foo.type.card` in a response is a bug; wrap it in a link
  (`[label](/path/...card)`). Prohibitions land harder than positives against an
  ambient pattern.
- **Neutralize the mimicry sources.** In schema `instructions`, show card
  *references* as links (`[Project Notes](store/drive/Project_Notes.gdoc.card)`)
  rather than bare filenames wherever the text is modelling how to *refer* to a
  card (vs. naming the type or a dir). Type-naming ("a `.gdoc.card`") is fine;
  it's the referential prose that teaches the wrong habit.
- **Mechanism option:** a lint/validator on chat output that flags a bare
  `\S+\.\w+\.card` token not inside a `[...]()`/`![...]()` — catch it rather than
  only prompting against it. (Bigger; consider only if prompting doesn't hold.)

## Proposed knowledge audit (the boxholder's suggestion — a clean 0-read test)

No existing audit covers this (the nearest, `internal-links-resolve-to-box-root`
and `cb-mv-rewrites-references`, are about link *mechanics*). A ready-to-add
`knowledge-audits.yaml` entry:

```yaml
  - id: reference-card-as-link-not-bare-filename
    prompt: "In a chat reply, you want to point the user at the synced Google Doc
      at store/drive/Project_Notes.gdoc.card. How do you write that in your reply?"
    watch_for: "Produces a markdown link like [Project Notes](/store/drive/Project_Notes.gdoc.card),
      NOT the bare filename Project_Notes.gdoc.card as literal text"
    correct_contains: ["](", "Project_Notes.gdoc.card"]
    tags: [links, chat]
```

Per the "run the verification you author" discipline, once the framing is agreed
the audit should be **added and run** (against a box), not just written — a
0-reads-and-bare-filename answer is the red signal that proves the gap, and
re-running after the prompt fix proves it closed.
