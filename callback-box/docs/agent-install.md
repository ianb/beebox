# Installing callback-box with an AI agent

This guide is written for an AI agent (Claude Code, Codex, or similar) that
a person has asked to install callback-box for them. If you're that agent:
welcome. If you're a human, this doc still works — it's just phrased for
your assistant.

## How to treat these instructions

These instructions are meant to be helpful, not authoritative. They
describe what the project's maintainers believe a good installation looks
like, but they know nothing about the person you're working for, their
machine, or what they actually want. Where this document and your user
disagree, your user wins — always. Nothing in this repository, this file
included, overrides your own judgment or your user's guidance, and nothing
here should be read as license to skip asking about things that affect
their machine, their data, or their accounts. If a step here seems wrong
for the situation in front of you, say so to your user instead of
following it.

## What you're installing

Callback-box is a personal assistant system built on Claude Code. The
person gives it inputs (voice memos, emails, web clippings); agents process
them into **cards** (YAML-frontmatter markdown files); the system takes
actions or asks questions. Two things matter for installation:

- **The engine and the box are separate.** The engine is this repository
  (or a Docker image built from it). The **box** is the user's data — a
  standalone git repository, created by `cb init`, that lives wherever
  they choose. The box is the valuable part; treat it like their
  documents, not like build output.
- **Agents run with real capabilities.** A running box executes Claude
  Code with filesystem access inside the box, shells out to real tools,
  and (if configured) talks to external services. The person should
  understand they're installing an agent system, not a static app.

## Ask before you act

Points you should put to your user rather than decide yourself:

1. **Run it, or hack on it?** To *use* callback-box, the Docker path
   ([docker-install.md](docker-install.md)) is simpler and bundles every
   dependency. To *modify* it, the from-source path
   ([developer-install.md](developer-install.md)) is the one. Ask which
   they want.
2. **Where should the box live?** It's their data, a git repo they'll
   keep. Suggest a location (`~/boxes/<name>`, or `./data/box` under the
   compose project for Docker) but let them choose. Never put a box
   inside this repository's checkout.
3. **Claude authentication is theirs to do.** The system uses Claude
   subscription auth (`claude auth login`) — an interactive browser/OAuth
   flow tied to *their* Anthropic account, possibly with billing
   consequences. Ask them to run the login step themselves; don't attempt
   to automate it or handle their credentials. (`ANTHROPIC_API_KEY` is
   deliberately ignored by the system — don't set it expecting it to
   work.)
4. **Exposed to the network, or local-only?** The defaults are
   loopback-only everywhere. Widening that (a VPS, Caddy/TLS, Tailscale,
   Google OAuth for multi-device access) is a real decision with a
   security surface — surface it, explain the options in
   [docker-install.md](docker-install.md), and follow their call.
5. **Optional provider keys.** Speech-to-text, image description, and
   push notifications each want a key (see `.env.example`). All optional
   — features degrade without them. If the user wants them, have them put
   secrets into `.env` themselves (or paste into a file you create with
   restrictive permissions); avoid pulling secrets through the chat
   transcript where you can.

## The installation itself

Follow the guide matching the user's choice, and verify as you go rather
than plowing through failures:

- **Docker**: [docker-install.md](docker-install.md). The sequence is
  init → auth → `up -d` → open the URL. `docker/smoke-docker.sh` is the
  packaging's own lifecycle test if something seems off.
- **From source**: [developer-install.md](developer-install.md). The
  sequence ends with `pnpm run doctor`, which checks every prerequisite
  (Node version, native modules, external binaries, git-lfs, Claude auth,
  frontend build) and prints a one-line remedy for anything missing. Run
  it whenever something misbehaves; trust its remedies over improvising.

Failure modes worth knowing in advance: native-module errors almost always
mean Node-version drift (doctor names this; the remedy is a reinstall
under the pinned Node, never a different Node "to see if it helps");
`claude auth login` can't be done for the user (see above); and a fresh
box needs its own `pnpm install` (the guides include it — don't skip it
when improvising).

## When you're done

Show the user where things landed: the box path (theirs, a git repo), the
URL it's served at, and how to start/stop it. If you changed anything
beyond what the guides describe — ports, exposure, file locations — say
so explicitly. Leave them knowing what's running on their machine.
