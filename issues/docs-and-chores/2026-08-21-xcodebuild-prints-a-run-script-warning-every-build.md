---
title: "Every xcodebuild run prints a 'will be run during every build' warning for the git-stamp script phase"
workstream: unattached
area: ios-app
labels: [ios, build, noise]
filed-by: agent
discovered-by: agent
discovered-in: voice-barge-in worktree — noticed while building for the screen-awake fix
---

Every `xcodebuild` invocation ends with:

```
note: Run script build phase 'Stamp git commit into Info.plist' will be run
during every build because the option to run the script phase "Based on
dependency analysis" is unchecked. (in target 'BeeBox' from project
'BeeBox')
```

It is not actionable as written — the phase *should* run every build, since the
git commit changes without any input file changing — but it costs agent context
on every build and every test run, which is the thing we treat as a bug.

The fix is to say so explicitly rather than leave it implied: set
`alwaysOutOfDate = 1` on that `PBXShellScriptBuildPhase` in `project.pbxproj`,
which is exactly what the note is asking for and silences it.

Small, but `project.pbxproj` is manually enumerated (`ios-app/CLAUDE.md`), so it
wants a deliberate edit and a build to confirm rather than a drive-by.
