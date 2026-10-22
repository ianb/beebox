# A gap the audit found
## Supporting: the 2026-07-03 full rerun
- All 217 audits reran; 31 were stale (the right answer had moved); 9 were real gaps; all 9 fixed
- A real gap, with its fix:

```text
### draft-email-placement — REAL GAP
- Prompt: "If you're drafting a reply to an email I received, where on disk
  should the draft card go?"
- Agent answered (consistent, 2 runs): box/output/ as an email-outbound card
- Why it's real: the schema instructions say reply drafts go inside the existing
  thread's .attach/ … a box/output/ draft would silently lose threading.
- Fix: corrective on the box/output/ row in box-shape.ts and email-message.tsx
```

Notes:
Path: beebox/docs/reports/knowledge-audit-rerun-2026-07-03.md. The exposed problem: audits go stale when guidance moves, and results are gitignored, so the durable record is hand-typed status comments in the YAML.
