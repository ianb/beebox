---
title: "The hub router doctest prints a box-identity stack trace for its fixture box"
workstream: unattached
area: beebox
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: docs-refresh-annex — running test/hub/server.router.doctest.md, 2026-10-16
---

`beebox/test/hub/server.router.doctest.md` passes, but it prints a warning
with a stack trace on every run:

```
box identity: could not read box content root /nonexistent/test1/_content: Error: ENOENT ...
    at async readBoxIdentity (src/core/landmark/box-identity.ts:99:19)
    at async <anonymous> (src/webapp/server-root/root-routes.ts:161:32)
```

The fixture's default box is `{ slug: "test1", boxRoot: "/nonexistent/test1" }`
(`server.router.doctest.md:92`). A route in that test reads the box identity,
and the missing content root is logged as a warning. That warning is expected
for this fixture, but it is unsolicited output and hides real warnings in the
run.

Either give the fixture a real temp box root, or capture the warning in the
test that triggers it and state that it is expected.
