---
title: "Addressable URIs for cards, elements, and versions"
workstream: unknown
needs: [design]
area: beebox
priority: backlog
---

Goal: every card, every addressable element inside a card, and every version of either should have a stable URI that can be pasted anywhere — emails, calendar events, chat assistants, other cards, external scripts — and resolved by the callback web UI.

Shape:

```
https://box.example.com/<box>/<path/to/Card.card>[@<version>][#<fragment>]
```

Where `<fragment>` follows cardworks' existing scheme (`id`, `query(xpath)`, `query-all(xpath)`).

The design stance is **historical truth over current validity**:

- Path rewrites on `bbx mv` continue to be applied to existing refs — that preserves identity, which is the right move.
- Version pins are sacred — a URI with `@1.0.0` should always resolve to that version's content, served from git history if the live card has moved past it. The web view shows a banner "viewing version 1.0.0; current is 1.2.0" with a link to current.
- An unversioned URI resolves to current (the common case).
- An invalid version (deleted, garbage-collected) shows a clear "version no longer available" rather than silently substituting.

This sidesteps the Obsidian failure mode where `[[Note]]` always resolves to current and link intent decays as notes evolve.

**Prerequisite work**: version semantics need to be deliberate again. Card root-tag versions got lazy after the ske era — for URI version pinning to be meaningful, versions need to change on meaningful events (schema-incompatible change, significant content revision) rather than be noise or always-1.0.0. Worth a deliberate pass on what bumps a version, who does the bumping (agent at edit time? schema-driven?), and how garbage collection interacts with the "every old version is addressable" promise (it probably means *never* GC versions referenced by any live ref).

No `callback://` URI scheme needed — plain `https://` does the job and works across email, calendar, external apps, and chat without any handler registration.
