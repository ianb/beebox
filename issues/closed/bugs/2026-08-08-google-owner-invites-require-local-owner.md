---
title: "Google-authenticated owners cannot create local member accounts without SSH"
workstream: member-password-reset
area: beebox
needs:
  - design
filed-by: agent
discovered-in: "worktree-member-password-reset — testing hosted invite and reset administration"
resolution: implemented
---

Implemented by `5bdad22d`. Signed-in configured owners can now issue invite and
member password-reset links without a local owner account. Invite acceptance can
initialize a member-only credential store, and an empty-store tombstone keeps
first-run owner setup permanently closed after the final member is removed.

A signed-in box owner can administer the box through Google sign-in, but the
Admin invite action requires a matching local-password owner record. A hosted
operator therefore sees an instruction to run `bbx auth create-user` on the
server before they can invite a member. That instruction is not practical for
normal web administration and is not necessary to authorize the action: the
owner-only web procedure already authenticates the operator.

The same local-owner precondition also blocks password-reset links for members
after they have joined. The local credential file currently requires exactly
one owner, so accepting the first invite cannot initialize a member-only local
credential store.

**Job to be done:** When I administer a hosted box through Google sign-in, I
want to invite and recover local-password members from Admin, so I do not need
shell access or a local owner password that I do not otherwise use.

The fix needs an explicit credential-file transition, safe concurrent first
account creation, and tests for both invite acceptance and later member reset.
