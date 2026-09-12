---
description: "Checklist of what Bee Box needs: a machine that stays on, a coding-agent login, accounts per connector, Docker, and running model cost."
---
# What it requires

Bee Box runs on your own machine, not as a hosted service. A **box** is your
data directory, and **the agent** is the coding agent that operates it.

**A machine that stays on.** A Mac or Linux computer at home, or a small
VPS. The documentation says a $5/month VPS is enough for the container path.
The box runs on a full computer; the design rules out serverless hosting. It
does not run on a phone.

**A coding-agent login.** Claude Code or Codex. For Claude, the documentation
requires you to sign in with a Claude subscription yourself; it says an API
key alone will not work, by design. The documentation does not describe
running Bee Box against a local model.

**Accounts, per connector, all optional.** A Google account, plus signing in
with it and a one-time setup, for Gmail, Calendar, and Drive; the
documentation calls that setup the hardest part of installing today. A Telegram bot token for
Telegram. A transcription vendor key (Mistral, OpenAI, or Deepgram) for
voice. A Cloudflare account for publishing. A git remote if you want the box
pushed off the machine. Photos, voice, and typing need none of these.

**Docker, or the from-source prerequisites.** The container path needs Docker
with Compose v2 and a clone of the repository, since no image is published
yet. The from-source path needs Node 24, pnpm, and several system binaries
(`pandoc`, ImageMagick, `poppler-utils`, `git-lfs`, an Excel reader,
`fclones`).

**Running cost: model usage.** Each agent turn sends its context to the model
provider, so a running box eats into your subscription's usage limits, or
runs up a bill if you pay per use.
The documentation states this plainly and does not publish any figure for a
typical monthly cost.

**Setup time.** The install guides imply minutes of commands on the
container path: initialize the box, log in to Claude, start the container,
open the URL, plus a one-time box-local install on first run. Connecting
Google is a separate, slower step; the documentation suggests treating Gmail
and Calendar as the second week rather than the first hour.

Next: [trying it](09-trying-it.md) and
[your data and safety](10-your-data-and-safety.md).
