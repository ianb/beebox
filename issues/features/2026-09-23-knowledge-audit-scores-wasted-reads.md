---
title: "Knowledge audits should count the documents that did not help, not only whether the right one was read"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request after the 2026-09-23 knip-sweep work
---

A knowledge audit checks recall: did the agent find the target knowledge?
`should_read`, `should_read_any`, and response checks
(`beebox/src/dev/lib/audit-checks.ts:45`) all measure that. The harness logs
every file read (`behavior.filesRead`, `beebox/src/dev/knowledge-audit.ts:174`),
but no check scores the reads that did not help.

An agent that is ready to work hard can scan many documents and still pass. That
is also a failure. It costs time and context, and it shows that the guidance did
not point the agent to the right place. The audit reports this run as a pass.

`should_not_read` catches only reads that the author named in advance. It does
not catch the general case.

## Tension

- An audit has to define which reads helped. Candidates: the `should_read` /
  `should_read_any` set, always-loaded files, and files whose content appears
  in the answer. Anything else counts as waste.
- Pass/fail or a score? A hard cap on extra reads makes an audit fail when a
  reasonable exploration path changes. A reported ratio (helpful reads / all
  reads, plus the list of the others) is safer as the first step.
- The report should list the reads that did not help. The pattern of those
  reads shows which guidance sent the agent the wrong way.

Related: [over-centering on the box](../exploration/2026-09-23-agent-over-centers-general-questions-on-the-box.md)
is the same failure from a question that needed no box research at all.
