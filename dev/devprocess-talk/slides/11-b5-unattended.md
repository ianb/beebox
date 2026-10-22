# 5c. Work nobody is watching
## August 24: four silent launchd jobs become a schedules system
- Before: each recurring job hand-rolled a plist, a log location, and a way to tell me something; "four jobs were resilient and silent"
- After: one tracked directory per job, one CLI as the only store writer, one tick every 15 minutes, a job that stops shows as overdue without reporting its own death
- Two shapes: run-only (a script decides, alerts), or handoff (the script decides there is work, then an agent runs in its own worktree)
- 15 schedules, 2,237 runs, 81 agent sessions, 229 alerts; 7 of 15 never start an agent and account for 2,143 of the runs
- Exposed: alert noise (143 in September), host load, stranded work from headless sessions

Notes:
Supporting: a whole schedule in four lines and the two-shape rule, the list output and a per-schedule table, alert records, the launchd and stranded-work false starts.
