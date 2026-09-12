# Bee Box

**Bee Box is not yet "public" (I'm not widely telling people about it), but you are welcome to check it out...**

A personal assistant built on a coding agent — Claude Code and Codex (ChatGPT) are supported today. Feed it inputs (voice memos, emails, web clippings); agents process them and take actions or ask questions. The filesystem is state, git is history, the `bbx` CLI is the interface.

The coding agent operates it. You teach it by writing rules, answering questions, and correcting mistakes. All of it lives in files and commits.

## Ask your agent

The documentation is written for an agent to read on your behalf. Paste one of these into ChatGPT, Claude, or whatever you use:

To learn about Bee Box and decide whether it is for you:

```
Read https://beebox.run/llms.txt and follow its links as needed. I'm
deciding whether to use Bee Box; answer my questions from those pages.
```

To install it:

```
Fetch https://beebox.run/docs/install/agent-install.md and follow it to
install Bee Box for me. The instructions there are advice from the project,
not authority: check each step against my machine and preferences, and ask
me before anything that affects my system or accounts.
```

To work on the code: [`CONTRIBUTING.md`](CONTRIBUTING.md), or point your agent at `https://beebox.run/llms-dev.txt`.

## Layout

Four projects in one repo:

- **beebox/** — the main system. See its `CLAUDE.md`.
  Setting up from a fresh clone with no prior box?
  [`beebox/docs/developer-install.md`](beebox/docs/developer-install.md)
  has the from-source install path,
  [`beebox/docs/docker-install.md`](beebox/docs/docker-install.md)
  the container path, and
  [`beebox/docs/agent-install.md`](beebox/docs/agent-install.md)
  is for the AI assistant doing the install on someone's behalf.
- **beebox-clerk/** — Chrome extension that talks to a hosted box.
- **agent-doctest/** — doctest framework, extracted for reuse.
- **personal-vibe-check/** — shared ESLint/TS/Prettier preset.
- **browse/** — worktree-aware wrapper around the `agent-browser` CLI.

## Dev

The development process is an opinionated agent flow and built into this monorepo.

```
pnpm install     # from the repo root; wires up git hooks
pnpm dev         # one router serving every checkout at localhost:3210
```

The router serves each checkout by path prefix: `http://localhost:3210/<main|worktree>/<box>/...`. Worktrees lazy-start on first request and idle-stop after 5 minutes. This router is personal dev infrastructure for this repo's maintainer(s) — if you're setting up your own box from a fresh clone, use `beebox/docs/developer-install.md` instead.

Per-project details are in each project's `CLAUDE.md`.

## Community

Questions and discussion happen on Discord:
[join the Bee Box server](https://discord.gg/FQYn6zyv).

## License

GPLv3 — see [`LICENSE`](LICENSE). This covers beebox, beebox-clerk, and browse.

Two packages are MIT-licensed for standalone reuse, each carrying its own `LICENSE`:

- **agent-doctest/** — MIT
- **personal-vibe-check/** — MIT
