---
title: "Card refs can never point into node_modules (by design), but the agent guide's ref-path rule doesn't say so — agents keep trying to link package docs"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
resolution: implemented
---

> Closed 2026-09-24 (boxholder chose both fixes): `REF_PATH_RULE` now says a ref reaches only the box's areas and package docs are read, not linked. A ref the namespace fence refuses now reports "points outside the box" with the rule, in all three broken-ref checks (`brokenRefReason`, `beebox/src/core/ref-exists.ts`). Whether refs should reach package docs stays with the linked 2026-07-07 design issue.

An agent wrote a markdown link from a card to a package doc (a `box-docs/*.md`
file shipped inside the `beebox` package, resolved via node_modules) and the
validator reported "does not exist," with no indication of why a
leading-slash, box-root-relative path — which the agent guide says is always
correct — failed. The agent fell back to writing the path as plain-text
backticks, which is not a clickable link.

A related, sharper version of the same gap: filing `bbx feedback` about this
*also* failed, because the feedback text itself quoted the offending link and
tripped the same rule (`BBX002, "Link points outside the box"`) — which
turned out to be the clearest statement of the actual rule anywhere in the
system, and is not what the guide says.

## Mechanism

`beebox/src/shared/ref-path.ts` documents the design deliberately: refs must
resolve inside one of the box's underscore areas (`_content`, `_config`,
`_bookkeeping`, `_publish`, `_tmp`); "anything else — `src/`,
`node_modules/`, `.git/`, `CLAUDE.md`, `package.json`, any unlisted root
name — resolves to `null`, fail-closed." This is intentional (`one-root-box-
layout.md` Track B), not a bug — node_modules paths are excluded on purpose.

But `beebox/src/core/agent-guide/source.ts:15` states the rule agents
actually read as:

```
"**Always write a leading `/` — the path resolves from the box root.** " +
"The one exception is `attach/…`, the card's own attach scope. Never `../`. " +
```

This is the shared `REF_PATH_RULE` string, reused verbatim across guide
sections (per its own comment, "so the two can't drift"). It names exactly
one exception (`attach/…`) and never mentions that the box-root namespace
fence excludes `node_modules` (and `src/`, `.git/`, etc.) even though those
are, in a v2/package box, real paths "under the box root" in the filesystem
sense. An agent who has just been told "the guide tells agents to read
package docs by path" (per the feedback note) has no reason to expect that
the natural next step — linking that same doc from prose — is disallowed.

## Why the fix is not obvious

- The validator's rejection ("does not exist") is technically accurate (the
  ref resolves to `null`, and `null` reads as nonexistent) but doesn't
  distinguish "this path is genuinely missing" from "this path is outside the
  box namespace by design" — those are different problems for an author to
  diagnose, and only the BBX002 lint message on the *feedback* path happened
  to spell out the real rule ("Link points outside the box"). Whether the
  general "does not exist" ref-check should adopt that clearer wording is a
  product decision that touches every ref-resolution error site, not just
  this one.
- The guide fix (stating that package docs cannot be linked from a card and
  must be written as literal text) is cheap, but doesn't address the
  underlying friction: the guide already tells agents to *read* package docs
  by path, so a design that lets it also *link* them (e.g. resolving
  read-only paths under `node_modules` as valid ref targets) would remove the
  gap instead of just documenting it. That is the larger, `needs: design`
  question already open in
  `issues/docs-and-chores/2026-07-07-box-docs-reference-node-modules.md`
  (which is about deduplicating `docs/generated/` into the package, not about
  general ref-linking, but bears on the same node_modules-fence question).
