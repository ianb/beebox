# Contributing a change

A **box** is a user's data directory: cards, configuration, and state, kept
as a git repository. A **card** is one file with YAML frontmatter validated
against a schema, plus an optional markdown body.

## Before you start

Bee Box is early: one maintainer, changing fast. Bug reports are invited;
pull requests are not yet solicited. Read
[claude-md.md](beebox/CLAUDE.md) and [code-style.md](beebox/code-style.md) first: they
are what the maintainer's own coding agent reads before touching this
codebase, and a change that ignores them will need rework.

## Set up

Follow [developer-install.md](beebox/docs/developer-install.md) for prerequisites and the
install sequence. Once installed, create your own test box with `bbx init`
rather than reusing anyone else's; a box is a data directory, so making a new
one is cheap.

## Make the change

Read the relevant code and existing tests before writing new code; this
codebase has conventions that differ from generic defaults. Doctests are the
primary test format: markdown files whose code blocks run as executable
examples. See [testing.md](beebox/docs/testing.md) for the tiers and syntax. The lint
preset is strict on purpose, and rules are never disabled to make code pass;
fix the code instead.

## Verify

Run `pnpm typecheck`, `pnpm lint:changed`, and `pnpm test:changed` before
committing. The pre-commit hook runs the same checks and blocks a failing
commit.

## Docs

Reference documentation is flat under `docs/`: it describes the system as it
works now. Proposals and completed work live separately, under `plans/` and
`implemented-plans/`. A `pnpm doc-check` hook rejects a commit with a broken
documentation link. If your change adds new infrastructure, document it in
the same change.

## Where things live

- `src/cli/`: CLI commands
- `src/core/`: the wakeup cycle, agent invocation, procedures
- `src/connectors/`: integrations with external services (Gmail, Telegram, and others)
- `src/webapp/`: the Fastify server and tRPC routers
- `src/frontend/`: the React UI
- `src/schemas/`: card type definitions
- `test/`: doctests, mirroring `src/` paths
- `deploy/`: server provisioning and deployment scripts

See [module-map.md](beebox/docs/module-map.md) for the fuller `lib`/`shared`/`types`
boundary, and [engineering-principles.md](beebox/docs/engineering-principles.md) for the
reasoning behind these choices. Source: [github.com/ianb/beebox](https://github.com/ianb/beebox).
