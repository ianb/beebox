# Identity — what Callback Box is

A system that Claude Code operates over a **box**: a special place on disk —
files with defined inputs, outputs, and services. "A personal assistant
infrastructure built on Claude Code" (CLAUDE.md) is the working description;
**the ambition is an operating system** — a place you inhabit and build within,
not an app you open (ruling 3; the feel is `../architecture/spirit.md`'s
"It should feel like a place"). It's not meant to feel like a work tool, even
if it could be used professionally.

## Interface: web UI privileged, documents as the record

Both, now (rulings 1, 6, 7):

- **The web UI is the main UI, and a real focus** — the privileged, richest
  surface, with a design system, capture pages, SSR, and the
  [interface-as-cards](../plans/interface-as-cards.md) direction built entirely
  around it. The early framing of the web app as a debugging viewer that would
  "later split into a cleaner user-facing view" is fully out of date; the split
  that actually exists is the permission boundary (Admin/OAuth stays shell;
  everything else is product surface).
- **Conversation and chat are important** — chat is the central page and a
  continuous presence (see `interaction-model.md`).
- **The documents are the result and the main method of record.** The original
  "the interface is documents, not a UI" claim was about where truth lives,
  not where interaction happens: the filesystem is the state; the web UI and
  chat are how you touch it.

## Shared boxes, one sharing granularity each

Boxes are **shared** (ruling 2). Sometimes one person, but a box can hold
multiple people (the household box of `../architecture/01-what-is-this.md` is
the design target, not a dramatization). A box has exactly **one granularity
of sharing**: everyone in the box shares everything in it. Different groups or
subgroups need different boxes. Per-member identity beyond the auth allowlist
is not designed yet — aspiration, not description.

## Runs on a full computer, never serverless

The box runs locally, or remotely — but a remote deployment is always **a full
computer** (the production fleet: a resident `cb hub` routing to per-box
`cb serve` children). It will never run on AWS Lambda or similar serverless
slices (ruling 4). The old "local first, cloud later" section was a sequencing
note, not a design position; the hosted posture is first-class now
(`../implemented-plans/boxes-as-packages-v2.md`, including the
stranger-can-start-a-box-in-minutes goal).
