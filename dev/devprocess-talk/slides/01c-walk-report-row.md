# Every claim gets a bucket and evidence
## Supporting: one row from a walk report, 2026-10-08
- P product, H harness, E environment, U unverified, W wish
- The walker said two photos looked corrupted. They were: the repo's own rename commit had rewritten bytes inside the test JPEGs

```text
| # | Claim | Bucket | Evidence | Where it went |
| 19 | Note 2: both photos are "partly corrupted" | H (agent P+) | The journey's
  committed assets are damaged. Both fail djpeg. The upload was byte-exact. The
  damage came from the rename commit dab834811, which replaced the old two-letter
  CLI token with `bbx` inside binary files; the pre-rename blobs decode cleanly.
  The agent's diagnosis was correct. | no issue: harness defect 1 |
| 42 | Note 4: the page says "the user confirmed"; the walker is "the user". | P |
  The box agent guide says to address the user as "you" on any user-facing
  surface. The agent wrote "the user" anyway. | filed: agent-writes-the-user… |
```

Notes:
Path: beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md. The box agent inside the product got the diagnosis right; the harness had broken its own fixtures.
