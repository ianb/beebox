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
running Bee Box against a local model. On a server or other machine with no
browser to sign in from, a long-lived token created with `claude setup-token`
(good for about a year) takes the place of the interactive sign-in. A box can optionally run other vendors'
models on the Claude side instead: GLM models through a Z.ai key, or models the
owner adds through an OpenRouter key (billed per use). Only three OpenRouter
models are recorded as tested through a full agent turn, and the documentation
warns that others may fail turns that need tools.

**Accounts, per connector, all optional.** A Google account, plus signing in
with it and a one-time setup, for Gmail, Calendar, and Drive; the
documentation calls that setup the hardest part of installing today. A transcription vendor key (Mistral, OpenAI, or Deepgram) for
voice. A Cloudflare account for publishing. A git remote if you want the box
pushed off the machine. A place to keep encrypted backups (an SFTP server, an
S3-compatible bucket, Backblaze B2, or a local directory) if you want them; the
box makes none until you set one up ([backups](install/backups.md)). Photos, voice, and typing need none of
these.

**Docker, or the from-source prerequisites.** The container path needs Docker
with Compose v2 and a clone of the repository, because the install guide
builds the image from that clone. A prebuilt image is also published daily to
GitHub's container registry (the Mac app uses it), but the Docker guide does not
yet describe pulling it. The from-source path needs Node 24, pnpm, and several system binaries
(`pandoc`, ImageMagick, `poppler-utils`, `git-lfs`, an Excel reader,
`fclones`, and `shellcheck` for the commit hook).

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
