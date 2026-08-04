---
title: "annex.largefiles is case-sensitive — an iOS .HEIC is committed to git as raw bytes"
area: callback-box
filed-by: agent
discovered-in: capture-agent-driven worktree — scoping the annex filter attributes
---

`assetLargefilesExpression()` renders `include=*.heic or include=*.jpg or …`,
all lowercase. git-annex matches those globs **case-sensitively**, so an
upper- or mixed-case asset filename never reaches the annex — its bytes go
straight into git's object database, which is the `.frozen` failure mode again
with a different cause.

Verified with git-annex 10.20260717:

```
$ git annex matchexpression "include=*.jpg or include=*.heic" --largefiles --file UPPER.JPG
$ echo $?
1
$ git annex matchexpression "include=*.jpg or include=*.heic" --largefiles --file lower.jpg
$ echo $?
0
```

And end to end in a throwaway annexed repo (largefiles set from the real
expression), committing `IMG.HEIC` and `second.jpg` together:

```
second.jpg staged size: 101      # annex pointer
IMG.HEIC   staged size: 300000   # raw bytes in git
```

`.HEIC` is the live case: it is what an iPhone produces, and the iOS app's
capture path is a first-class intake surface.

`isAssetExtension()` (the guard, the unlisted-binary scan, the `to-annex`
verification) lowercases before comparing, so nothing in the codebase reports
the gap — the classifier and the thing that acts on it disagree, and only the
half that acts is case-sensitive.

Fix is presumably to render each extension as a character class the way
`assetAnnexAttributes()` now does (`include=*.[hH][eE][iI][cC]`), or to
normalize filenames at intake. Either way it needs a decision about assets
already committed as raw bytes on existing boxes — a `git add --renormalize`
after the expression changes would move them into the annex, but their bytes
stay in history.

Not fixed alongside the attributes-scoping change that found it: that change
deliberately covers both cases in `.git/info/attributes` (an over-wide filter
line is harmless), so it neither causes nor worsens this — but it does mean the
attributes list and `annex.largefiles` now disagree on purpose, with a comment
saying why.
