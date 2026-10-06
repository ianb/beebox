---
title: "Research OpenInstinct: an iMessage assistant that acts on real websites"
workstream: unattached
area: beebox
labels: [competitive-research]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder found openinstinct.sh, 2026-09-25
---

The boxholder found [OpenInstinct](https://openinstinct.sh/)
([source on GitHub](https://github.com/Merit-Systems/OpenInstinct)), made by
Merit Systems under the MIT license. It is a personal assistant that the user
talks to through iMessage. It does tasks on real websites, such as booking
appointments, ordering groceries, and filling forms. It uses a cloud browser
for sign-in and checkout.

Its published shape, as the landing page states it on 2026-09-25:

- The user deploys it to their own Vercel account with one button, in about
  five minutes. It needs an iPhone. The user pays for the services under it
  (Vercel, Kernel, Neon, Linq, AI Gateway).
- The model is any model on Vercel AI Gateway, set in one file.
- It asks for approval before purchases, email, calendar events, and
  destructive changes.
- Passwords and cards are stored as ciphertext. The model receives only
  handles to secrets and never the values.

The tension: Bee Box and OpenInstinct are both self-deployed personal
assistants, but they make opposite base choices. Bee Box uses a coding agent
over files the user owns and adds capture from the phone. OpenInstinct uses a
hosted serverless stack, a chat channel the user already has, and web actions.
Some of its choices can apply to Bee Box. The research must find which ones.

Related:

- [Write-only secret capture in chat](../features/2026-07-19-write-only-secret-capture-in-chat.md):
  OpenInstinct's secret handles can be a reference design for this.
- [Connectors through Composio's managed auth](../features/2026-09-06-connectors-via-composio-managed-auth.md):
  another way to reduce setup work.
- The `browser-task` skill runs box browser tasks in the boxholder's own
  Chrome. OpenInstinct uses a cloud browser instead.

## Research (incomplete)

Read the repository, not only the landing page. Answer these questions:

1. How does it store secrets, and how does the model use a handle? Can a
   handle design supply the write-only secret capture issue above?
2. How does the approval gate work? Which actions does it gate, and how does
   the user approve in iMessage? Compare this with how Bee Box asks
   questions.
3. What does it remember between conversations, and where? Does it learn
   from corrections?
4. How does the cloud browser (Kernel) keep sessions signed in, and handle
   2FA and CAPTCHA? What does this cost, and what are the privacy trade-offs
   compared with the boxholder's own Chrome?
5. How does iMessage reach the agent (Linq)? Is a text-message channel a
   useful capture or question surface for Bee Box, next to the iOS app?
6. How much setup does it really take? Compare its accounts and keys with a
   Bee Box install.

Report substantive differences only. Do not list the obvious ones (hosted
compared with local, and files compared with a database) unless they have a
non-obvious consequence.
