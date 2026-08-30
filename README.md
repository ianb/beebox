# beebox

A personal assistant built on Claude Code. Feed it inputs (voice memos, emails, web clippings); agents process them and take actions or ask questions. The filesystem is state, git is history, the `bbx` CLI is the interface.

Claude Code operates it. You teach it by writing rules, answering questions, and correcting mistakes. All of it lives in files and commits.

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

```
pnpm install     # from the repo root; wires up git hooks
pnpm dev         # one router serving every checkout at localhost:3210
```

The router serves each checkout by path prefix: `http://localhost:3210/<main|worktree>/<box>/...`. Worktrees lazy-start on first request and idle-stop after 5 minutes. This router is personal dev infrastructure for this repo's maintainer(s) — if you're setting up your own box from a fresh clone, use `beebox/docs/developer-install.md` instead.

Per-project details are in each project's `CLAUDE.md`.

## Community

Questions and discussion happen on Zulip:
[beebox.zulipchat.com](https://beebox.zulipchat.com/).

## License

GPLv3 — see [`LICENSE`](LICENSE). This covers beebox, beebox-clerk, and browse.

Two packages are MIT-licensed for standalone reuse, each carrying its own `LICENSE`:

- **agent-doctest/** — MIT
- **personal-vibe-check/** — MIT
