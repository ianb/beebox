---
title: "rewrite-card-refs warns \"escapes the box\" for a ref outside the namespace fence, on every rewrite pass"
workstream: card-self-refs
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: card-self-refs — test-box run of the filename-attach-scope migration
---

`resolveRefToAbs` (`beebox/src/core/rewrite-card-refs.ts:77`) prints
`ref "…" in <card> escapes the box; leaving unchanged` whenever
`resolveRefPath` returns null. A legacy v2 ref such as `/store/archive/…`
returns null because it is outside the namespace fence
(`beebox/src/shared/ref-path.ts`, `fenced`), not because it climbs out of the
box. The message sends the reader looking for a `..` that is not there.

It prints on every box-wide rewrite pass (`bbx mv`, the ref-rewriting
migrations), once per matching token, for a ref the pass does not touch. On
the test box, one stock procedure card printed it twice during a migration run.

Fix: say which rule refused the ref, and consider whether a ref the pass
leaves alone needs a line at all; `bbx validate` already reports it as broken.
