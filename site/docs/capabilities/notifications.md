---
description: "How a box reaches you when you are not looking: a badge, a quiet push, or a loud one, plus reminders and watches the agent sets up for you."
---
# Notifications

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Notifications are how the box tells you something when you do not have it
open, and how it stays quiet when you do.

**What it does for you**

- Reaches you three ways, by how much the thing matters: a badge only, a quiet
  notification with no sound, or a loud one with sound. A tap opens the
  matching place in the box: a chat, a card, a question, or the dashboard.
- Delivers to the paired iPhone app, to a browser that has allowed web push,
  and to Telegram. Each message goes only to the channels that fit its loudness.
- Stays silent while you are looking at the box: if a web session of yours was
  active in the last two minutes, a quiet or loud message shows as a banner in
  the open app instead of being pushed.
- Lets the agent set a reminder for a fixed time, which fires from the
  schedule with no agent running, and delete itself after it fires.
- Lets the agent set up a watch ("tell me when the school emails about the field
  trip"): a schedule looks at what changed in the box since its last run, a
  small judging model decides whether it matters, and only then is a
  notification written, so routine changes produce nothing.
- Follows rules you can read and edit. When and how loud to reach you is a
  "Reaching me" section in the box's root briefing, which new boxes start with
  and the agent consults before notifying anyone.
- Keeps a log of every attempt and its outcome (sent, skipped because you were
  present, no device to reach, failed), shown in the Admin page's
  Notifications section with the paired phones.
- Tells you when something you asked for cannot run. A schedule you requested
  that is held back, for lack of a connector or a model key, is announced once
  per episode, loudly.

By default a question the agent asks you is a badge, not a push, unless it is
time-bound; a question that sits unanswered for a week gets one quiet push
before it expires. A capture from your phone that fails for good tells you,
if nobody is at the box.

**What it needs**

For the iPhone app and web push, keys held once for the whole server, set up by
whoever runs the machine. See [../install/index.md](../install/index.md) and
[../concepts/connectors.md](../concepts/connectors.md). Telegram needs its own
connection. The watch's judging model is the same routing model quick chat
uses, reached through OpenRouter, so it needs an OpenRouter key granted to the
box; without one, a watch that depends on a judgment waits and says so.

**How it works, briefly**

Everything that tells you something passes through one function in the box
server, whether the agent asked through a command or the engine itself wanted
to. Channels, loudness, who is present, and the log are plain files in the
box's hidden working folder, which git ignores. Reminders and watches are
cards under the box's schedules folder, so they are in git and the agent can
read them. See [schedules.md](schedules.md) and
[questions.md](questions.md).

**Limits**

The documentation records that the real-device walk-through (a paired phone
receiving loud, quiet, and badge notifications, a reminder arriving on time, a
watch firing on a real email) has not yet been run; the tests use stand-in
delivery services and a simulator. Push to the iPhone uses an Apple key that
belongs to whoever builds and installs the app, so it works for a person
running their own build, not for a shared app; a relay for that case is
filed as future work. Health problems (a failing sync, an expired sign-in) show
on the dashboard and do not notify on their own. The judging model is sent the text of the changed
cards it is asked about, through OpenRouter, with a request that the provider
not retain it, and it has a daily cap of 500 calls per box.

**Go deeper**

[../reference/bbx-commands.md](../reference/bbx-commands.md),
[../reference/cards/scheduled-script.md](../reference/cards/scheduled-script.md),
[../10-your-data-and-safety.md](../10-your-data-and-safety.md)
