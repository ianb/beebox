---
title: "Ref path normalization"
workstream: unknown
area: callback-box
resolution: implemented
---

**Closed 2026-07-30** — implemented as Track F of
`callback-box/docs/implemented-plans/box-root-paths.md`: `cb validate --canonical` reports
every document-relative ref with its box-root rewrite (two buckets: card refs
and `.md` dossier links), and `cb validate --canonical --fix` normalizes the
ones whose target actually exists. Off by default, per the plan's rationale —
a default-on warning would bury the broken-ref signal under legacy relative
refs. The lint-rule idea below is the report; the "loader normalizes on save"
idea was deliberately not taken (liberal resolution is permanent, normalization
is per-box opt-in).

Refs in cards use paths like `ref="../../../store/archive/Foo.record.card"` which are fragile and hard to read. Absolute refs (`ref="/store/archive/Foo.record.card"`) are already supported and preferred.

Ideas for automatic normalization:
- `cb validate --fix` could rewrite relative refs to absolute
- `cb create` could resolve ref arguments to absolute paths before writing
- The card loader could normalize refs on save (convert relative→absolute)
- A lint rule could warn on relative refs that go above the card's parent directory
