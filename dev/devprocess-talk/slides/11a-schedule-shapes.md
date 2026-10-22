# A whole scheduled job is four lines
## Supporting: schedules/disk-hygiene and the two-shape rule
```yaml
description: "Disk hygiene: prune rebuildable caches weekly; alert when free disk stays low"
cadence: 1d
# No `workstream:`: pruning rebuildable caches needs no judgment, and a disk
# that stays full after pruning needs a person choosing what to delete.
```

```markdown
Pick one of two shapes:
- **Run-only:** no `workstream:`; the alert is the whole product. docling-update
  alerts once when a settled newer release exists. It does not bump the pin,
  because an upgrade means re-reading `docling convert --help` and
  re-extracting a sample, which is judgment.
- **Handoff to a workstream:** the script decides whether there is work and an
  agent decides what to do about it. knip-sweep runs knip, diffs against last
  week's report, and hands off only what is new.

In both shapes `run` only gathers, compares, and decides whether anything
changed. `prompt.md` holds the judgment… A `run` that reasons about its
findings will be wrong at 03:00 with nobody watching.
```

Notes:
Path: bin/docs/schedules.md. The split is why hourly cadences are affordable: the SDK monitor's "persistent Opus session starts on the days something was actually published instead of every day at 12:04".
