---
title: "A non-owner cannot see or revoke their own paired device, and the panel says so as a raw permission string"
workstream: ios-pairing-papercuts
area: beebox
labels: [ios, pairing]
filed-by: agent
resolution: implemented
discovered-by: Ian
discovered-in: worktree-ios-pairing-papercuts — pairing a phone as a non-owner, then opening Settings in its webview
---

Anyone with box access can now pair their own phone
(`pairing.createTicket` is `authedProcedure`, and a paired device acts as
whoever paired it). But `pairing.devices` and `pairing.revokeDevice` stayed
`ownerProcedure`, deliberately: they span every device on the box, including
other people's.

The consequence nobody chose: a non-owner's phone is in that list and its
person can neither see it nor kill it. Only the owner can. A member who loses
a phone has to ask the owner to revoke it, and has no way to confirm which
devices are theirs.

The boxholder's call, 2026-09-12: "certainly if you can pair you should be able
to unpair". Both halves below are now implemented — `devices` and `revokeDevice`
are `authedProcedure` scoped by `mayManageMobileDevice`, and the panel names the
list it got instead of printing a permission string.

Two things were tangled here, and only the first was settled when this was filed:

**The message is wrong either way.** `CompanionPairingSection.tsx` renders
`devicesQuery.error.message` verbatim, so a non-owner reads "Owner access
required" under the "Paired devices" heading. A bare permission string tells
nobody who can see this, why, or what to do instead. Whatever is decided
below, a `FORBIDDEN` here should become prose.

**Whether a non-owner should see their own devices is the decision
(`needs: [decision]`).** The narrow shape is a `myDevices` / `revokeMyDevice`
pair on `authedProcedure`, filtered to `createdBy === ctx.user.email` — a
person manages their own devices, the owner keeps the whole-box view. It fits
the reasoning that moved `createTicket` in the first place: you pair your own
device. The argument against is surface for surface's sake, if members who
are not the owner are rare enough that the owner revoking on request is fine.

Note the filter would be blind to devices paired before `createdBy` was
recorded — those carry `createdBy: null` and belong to nobody, so they would
be owner-only regardless. That is correct, not a gap to paper over.

Anchors: `beebox/src/webapp/trpc/routers/pairing.ts`,
`beebox/src/frontend/src/components/settings/CompanionPairingSection.tsx`,
`beebox/docs/mobile-contract.md` §1.2.
