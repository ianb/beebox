---
title: "The manual-testing queue always links landed work to main dev, even when the test target is production or a device"
workstream: unattached
needs: [design]
area: workstreams-app
design: ../../callback-box/docs/implemented-plans/workstreams.md
labels: [workstreams, manual-testing, testing-queue]
filed-by: agent
discovered-by: agent
discovered-in: worktree-streams-and-issues — reviewing the staging-slot exploration
---

*When a fix needs verification on a specific environment, I want the testing
queue to open that environment, so I do not accidentally confirm the behavior
against main dev instead.*

The implemented workstreams plan specified a per-item **test target**. It named
three possible destinations: the pinned worktree, the deployed app, or local
main. The current `TestingPage.tsx` implements only two derived links:

```ts
const target = worktree ? `/${worktree}/test1/` : "/main/test1/";
```

Every landed item therefore links to main dev. That is wrong for checks that
explicitly depend on nginx, TLS, systemd, deployed migrations, public
callbacks, production credentials, or a paired device. The issue's `## Manual
testing` prose can name the correct URL or command, but the queue's prominent
target link still points somewhere else.

This surfaced while settling
[the pre-merge staging-slot exploration](../closed/exploration/2026-08-09-staging-slot-for-premerge-testing.md).
A staging environment is not the fix for this smaller information-model gap.

## Design before implementation

Do not put an arbitrary public URL into a public issue by default. Production
origins and private-box slugs can be developer-specific. Decide a small target
vocabulary and how each target resolves locally. A likely shape is:

- a derived worktree target for pre-merge rows;
- `main` as the landed default;
- `production` resolved through the existing gitignored deploy public-URL
  configuration; and
- `instructions-only` for physical-device or command-based checks, with no
  misleading app link.

The design must also decide whether a target can include a safe relative path,
how private issues resolve private box slugs without leaking them into public
data, and what the UI shows when local production configuration is absent.

Done means the queue labels the target explicitly and never renders a main-dev
link for an item that declares another target.
