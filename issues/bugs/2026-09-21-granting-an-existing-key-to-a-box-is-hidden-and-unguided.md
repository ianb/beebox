---
title: "Granting a key the system already holds is hidden, duplicating one is silent, and nothing says whether to grant server or agent"
workstream: unattached
area: beebox
labels: [admin, secrets, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder working in the admin Secrets section
priority: normal
---

Three complaints about one flow, from the boxholder:

> it's not obvious how to grant a key to a box that doesn't have it, but is
> available in the system. Also it's easy to add a key that's also available
> in the system, and no warning. And it's not clear if you should grant such a
> key to the server or agents.

## 1. The grant is behind a disclosure

`GrantExistingForm` sits inside `<details id="bbx-admin-secrets-advanced">`
labelled "Use a key another box already has"
(`beebox/src/frontend/src/components/admin/SecretsSection.tsx:90-93`). The
disclosure is closed by default and appears only when `grantable.length > 0`.

That placement was deliberate: the section's own comment says "granting is the
advanced, multi-box case, not the primary one"
(`SecretsSection.tsx:11`, `SecretsSection-grant.tsx:2`), and the primary case
— paste a key, have it work — is the top form. The boxholder now has several
boxes, so the case the design called advanced is the ordinary one, and the
form that does the right thing is the one folded away.

## 2. Adding a duplicate is silent

The add form (`SecretsSection-forms.tsx`) does not check the machine store for
the name being typed. A boxholder who does not find the grant disclosure will
paste the same provider key again under the same name, and nothing says the
system already holds it. The result is two custodies of one credential:
rotating it in one place leaves the other stale, and the access log splits.

The form already does adjacent work — it suggests a known name when the typed
one matches nothing (`SecretsSection-forms.tsx`, the `suggestion` path), so
the machinery to compare against known names is present. The missing piece is
the opposite direction: the name IS known, elsewhere.

## 3. Server versus agent is a real decision with no guidance at the point of choice

The grant form offers exactly two options, labelled
(`SecretsSection-grant.tsx:83-85`):

- `server — connectors only, never disclosed to the agent`
- `agent — box code may resolve the value at call time`

The rule behind them is in `core/secrets/resolve.ts:9-14`: `server` is asserted
by connector code inside a server process; `agent` is asserted by anything
resolving on behalf of box-authored code, and an `agent` grant includes server
access. So `agent` is strictly wider, and the comment is explicit that nothing
enforces the assertion below the call — it is "a legibility and blast-radius
boundary, not a wall".

What the boxholder cannot tell from the two labels is which one THIS key needs,
which depends on what will consume it: a connector wants `server`; a trick or
box-authored code wants `agent`. Nothing in the form knows which, though the
system does have the information in places — the format and guide registries
(`core/secrets/format-registry.ts`, `guide-registry.ts`) describe what each
known name is for, and declared uses exist (`SecretsSection-uses.tsx`).

## Why this is one issue

All three are the same gap: the form treats a key as a value to store, while
the boxholder is deciding about a credential that already exists somewhere in
their system. Fixing the duplicate warning without surfacing the grant just
tells them they are stuck; surfacing the grant without answering server-versus
-agent moves the confusion one step later.

Related: [the add form hides the names that work](../closed/features/2026-09-09-secrets-add-form-hides-the-names-that-work.md)
solved the neighbouring problem (which names the system recognizes) in the
same form; its approach is the obvious prior art.
