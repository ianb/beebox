---
title: "Support all interface orientations on iOS — the app claims iPad but was only ever laid out portrait"
workstream: unattached
area: beebox
needs: [design]
labels: [ios, layout, accessibility]
filed-by: agent
discovered-by: Ian
discovered-in: main session — Xcode build warning
priority: normal
---

Xcode warns:

> All interface orientations must be supported unless the app requires full
> screen.

It is a warning, not a build failure, and it is Xcode pointing at a claim the
project makes without backing it up.

## What the project actually declares

`ios-app/BeeBox.xcodeproj/project.pbxproj`:

```
TARGETED_DEVICE_FAMILY = "1,2"      # 1 = iPhone, 2 = iPad
```

with **no** `INFOPLIST_KEY_UISupportedInterfaceOrientations*` entries and **no**
`UIRequiresFullScreen`. So the app ships as an iPad app, and iPadOS requires all
four orientations from any app that has not opted out of multitasking — Slide
Over and Split View can hand it any of them.

Two other ways to silence the warning exist and are both worse:
`TARGETED_DEVICE_FAMILY = "1"` (drop iPad — honest, but gives up the platform)
and `UIRequiresFullScreen = YES` (opt out of multitasking — Apple has been
deprecating it, so it is a shrinking escape hatch). This issue is the decision
to do the real thing instead.

## The work is layout, not a plist key

The warning is one line to fix. What it exposes is that **the app has never been
laid out for anything but portrait iPhone**, confirmed while auditing the
input-plane work on 2026-08-16:

- `grep -rn landscape ios-app/` returns nothing outside the plan's own prose.
- The fixture-capture script (`ios-app/scripts/capture-composer-fixtures`) has a
  hardcoded portrait state list — the tooling *cannot* produce a landscape
  screenshot today.
- `docs/plans/ios-input-plane-parity.md:461-463` says landscape and the
  real-device matrix "are not yet accepted."

So this is the third distinct thing that traces back to the same gap. See
[iOS input-plane parity](2026-07-19-ios-input-plane-parity.md), whose Track 6
remainder this substantially is.

## What makes it harder than "rotate the phone"

**Multitasking is about size classes, not orientation.** Split View can give the
app a compact width on a large screen, and Slide Over a narrow column at full
height. An app that merely survives landscape can still break in Split View,
because the real variable is available width, not device rotation. Designing to
orientation and testing only rotation would meet the letter of the warning and
miss the point.

The composer is where this will hurt: the dock, attachment chips, the
autosizing editor, and the software keyboard all compete for vertical space,
and landscape roughly halves it. The invariants the parity plan already lists —
dock flush with the safe area, 44pt targets, chips scrolling rather than
compressing the editor, the keyboard never covering the active line — are
exactly the ones a short viewport breaks first.

## What the design has to settle

- **Is iPad a real target?** If the answer is "not yet," the honest move is
  `TARGETED_DEVICE_FAMILY = "1"` and closing this — but that should be a
  decision, not the result of a warning nobody wanted to read.
- **Which layouts change, and which merely tolerate.** A chat app in landscape
  can keep one column or use the width for a companion pane; those are
  different products, and the second is real design work.
- **Where the keyboard goes.** Landscape iPhone with the keyboard up leaves very
  little height; whether the composer floats, the transcript shrinks, or the
  keyboard is dismissed on send is a decision to make once and apply.
- **What "supported" means for upside-down.** It is in the required four on
  iPad and looks absurd on iPhone; the two idioms can declare different sets.

## Verification

Most of this is **simulator-reachable, and it has simply never been run** — a
distinction worth keeping, since the device-only remainder of the parity work
has been used to defer things a simulator could have caught. Extending
`capture-composer-fixtures` to emit landscape and Split View states across the
existing thirteen fixture states is the concrete first step, and it turns "we
think it works" into screenshots someone can look at.
