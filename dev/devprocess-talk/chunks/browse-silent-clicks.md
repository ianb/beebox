---
kind: rule
cue: silent clicks, it said done, the app doing nothing, refuse the click, an id on every control
with: browse-indirect-development, tool-user-is-agent, after-action-verify
source: commit 2fc153770 (Aug 23); slide 16c
---
# The browser said "done" when the click hit nothing
## The agents' browser tool
```text
… refuse silent clicks, and put ids on every static control
  agent-browser's click is a box-center mouse event with no preconditions:
  disabled, covered, off-screen, zero-size ... all report '✓ Done'.
  A journey walker read those as the app doing nothing.
```
