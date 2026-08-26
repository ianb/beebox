---
title: "Member-level tRPC procedures include config writes and code execution"
workstream: security-report
needs: [decision]
area: callback-box
filed-by: agent
discovered-in: worktree-security-report — endpoint inventory for the security report
---

The tRPC surface has three auth tiers: `ownerProcedure`,
`authedProcedure`, and `publicProcedure` — but behind the box auth wall
the latter two admit the same population (any box member, or any
agent/browse/mobile credential). `admin.*`, `pairing.*`, and
`scanTokens.*` are owner-gated. Several other state-changing or
code-executing procedures are not:

- `drive.mount` / `drive.unmount` / `drive.link` / `drive.syncFolder` and
  `calendar.updateConfig` (`src/webapp/trpc/routers/drive.ts`,
  `calendar.ts`) — any member can change which Drive folders / calendars
  sync, unlike the equivalent owner-gated config writes in `admin.ts`.
  (Was `drive.updateConfig` until 2026-08-26, when folder mounts became
  cards; the population question is unchanged.)
- `scheduler.trigger` (`src/webapp/trpc/routers/scheduler.ts`) — runs a
  scheduled script card's shell command immediately via
  `execWithTimeout`. The strongest code-execution surface in the tRPC
  tree, at member level.
- `commands.executeSync` (`src/webapp/trpc/routers/commands.ts`) — any
  registered command with client-supplied args, at member level.

In the common single-operator case (`allowedEmails` empty →
`canAccessBox` fails closed to owner-only) this is moot. It bites once a
box has invited members: membership currently implies near-owner
capability everywhere outside `admin.*`.

The decision needed: what is the intended member capability tier? Either
members are deliberately trusted with everything but admin (document
that in the invite flow and security-overview.md), or the config-writing and
code-executing procedures above move to `ownerProcedure`.
