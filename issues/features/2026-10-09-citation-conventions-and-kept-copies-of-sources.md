---
title: "One documented citation convention on {% source %}, and when to keep a durable copy of a source in the attach scope"
workstream: unattached
area: beebox
needs: [design]
labels: [provenance, box-guidance, competitive-research]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-notebooklm-research — after the Gemini Notebook citation comparison
---

The boxholder wants two things (2026-10-09): clearer conventions for
citations, kept on `{% source %}`, and instructions for putting durable
copies of sources inside attachments, so that a frozen web page or other
material can stand behind a citation. Keeping copies is not the default; it
is "simply not worth it" normally. In a research context, or when the person
asks, it is the right technique.

Background: [citations.md](../../research/notebooklm/citations.md) compares
Gemini Notebook's model (one frozen, offset-addressed text per source;
citations produced mechanically by retrieval) with the box's text-anchored
tag. The box's tag survives better and says more; its weaknesses are that
citing is optional, span anchors are rough, and a cited URL can change or
vanish with only a `version` hash to say so.

## What exists

- `{% source ref|href usage pos version retrieved %}` with the span as its
  body (`beebox/box-docs/provenance.md`); the chip jumps to the span by text
  match (`beebox/src/frontend/src/lib/selection/quote-anchor.ts`).
- The same vocabulary as frontmatter: `sources: [{ref|href, retrieved, pos,
  usage, label, note}]` (`beebox/src/cards/sources-entry.ts`).
- A `webpage` card: readable Markdown body, one `sources` entry with the URL
  and `retrieved`, and a frozen self-contained HTML snapshot at
  `attach/page.frozen` served sandboxed. Only the Chrome clerk produces one
  ([server-side capture](2026-09-11-server-side-webpage-capture.md) is open).
- `pdf`, `file`, `image` cards for other material; courses keep theirs in a
  `material/` directory and the build-course skill tells the tutor to bring
  material in and cite it.
- No sanctioned "fetch this into an attach scope with provenance" primitive
  ([issue](2026-09-21-save-image-with-provenance-first-class-command.md)).
- `bbx search` hits carry `path#fragment` locators; chat links do not honor
  the fragment (`beebox/src/frontend/src/lib/view-url.ts:137-144`).

The guidance is spread over the agent guide's PROVENANCE section, the
provenance doc, the webpage card instructions, and the courseware skill, and
none of it says when to keep a copy or how to cite one.

## Proposed convention (to design, then write)

1. **A citation names the thing the agent actually read.** A URL the agent
   fetched: `href` plus `retrieved`. A card in the box: `ref`. A kept copy:
   `ref` to the copy, never the URL alone; the copy's own `sources:` entry
   carries the URL and `retrieved`, so the chain URL → copy → claim is two
   hops and each hop is checkable.
2. **Default: no copy.** Cite with `href` and `retrieved`. The web is the
   archive and the box is not. This stays the rule for a quick fact, a chat
   answer, a recipe link, a product page.
3. **Keep a copy when any of these holds:** the box is in a research
   context (a landmark or course whose `CLAUDE.md` says so, a research
   procedure, or the person asked for it); the claim matters enough that
   someone will want to re-verify it later; the source is likely to change,
   vanish, or be hard to fetch again (paywall, login, a page that already
   blocked a fetch); or the material is the subject itself (a paper being
   studied, a letter being answered).
4. **Where a copy lives.** In the attach scope of the card that cites it, or
   in the place's `material/` directory when several cards share it (the
   course pattern). As a `webpage` card when it is a page (frozen snapshot
   when a producer exists, Markdown body always), a `pdf` card when it is a
   PDF, a `file` or `image` card otherwise. The copy is a card, so it is
   searchable and citable like anything else.
5. **Span anchors.** The verbatim span is the tag body; `pos` stays a rough
   human hint; when the span came from a search hit, carry the hit's
   `#fragment` in `ref`. Whether to add an exact text-fragment locator is the
   third gap in citations.md and can wait.
6. **`version` on kept copies.** Measure `sha256:` when citing a copy that
   may be refreshed; omit it for a URL citation, where `retrieved` is the
   honest signal.
7. **Chat answers cite the same way.** A research answer in chat uses
   `{% source %}` with the search hit's locator; a plain link is for pointing
   at a card, not for backing a claim.

## Where the guidance goes

Per the bbx-context tiers: the rule set in `beebox/box-docs/provenance.md`
(a "Keeping a copy" section and a "which form when" table), one line in the
agent guide's PROVENANCE section pointing at it, the when-to-keep-a-copy
trigger in the research write-up paragraph of
`beebox/docs/box/what-you-could-do.md`, and the courseware skill's existing
"bring material into the box" line made to use the same words. The root
`CLAUDE.md` gets nothing: this is not relevant on every turn.

## What blocks a full version

A frozen HTML copy of a page needs a producer the agent can call; today only
the clerk makes one. The convention can be written now with the Markdown
body as the copy (WebFetch, write a `webpage` card with `sources:`), and the
frozen snapshot arrives when server-side capture lands. The fetch-with-
provenance primitive would make step 4 one command.

## Open questions

- Does a kept copy count as box content for triage and search, or is it
  reference material that should rank below the person's own cards? Courses
  put material under the course; a research landmark would do the same.
- Whether "research context" is a landmark flag the agent reads, or only
  words in a `CLAUDE.md`. A flag is one more concept; words are enough to
  start.
- Size: a frozen page can be megabytes; the annex handles binaries, but a
  guideline on when a copy is too big belongs in the same section.
