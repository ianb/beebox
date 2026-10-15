# Humans type one skill
## Supporting: bin/skill-usage over 60 days (events/sessions)
```text
sessions: claude interactive 178, sdk 48, subagents 1870 | codex interactive 85, exec 426, subagents 298

skill               claude human  claude agent  codex human  codex agent
finish              182/128       42/39         182/74       140/44
cross-model         –             163/139       –            385/88
bbx-plan            –             51/50         13/12        138/43
browse              –             69/50         –            232/55
doctest             –             41/6          –            122/44
issues              –             23/23         –            135/42
bbx-pick-issues     24/8          3/2           –            11/3
launch-worktree-s.  –             15/15         –            91/7
knowledge-audit     –             9/9           –            63/22
bbx-debug (retired) –             –             –            74/20
```
- Written Oct 7 because the harness's own skill doctor was not available; prints names and counts only
- 31 skills created, 10 retired; SKILL.md lines 3,766 (Sep 12) → 1,841 (Oct 9)

Notes:
The craft skills (debug, frontend, codehealth, guide-testing) were the ones retired: "Current models debug and build UI without a skill; the repo-specific parts move to the docs that own those areas."
