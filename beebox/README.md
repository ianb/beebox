# beebox

beebox is a personal assistant and operating system built on Claude Code. You
give it inputs — voice memos, emails, web clippings, chat messages — an agent
processes them, and the system takes actions or asks questions. There's no
separate database: the filesystem is the state, Git is the history, and the
`bbx` CLI is the universal interface to a single operational directory called
a **box**.

It isn't an app you use so much as a system a Claude Code agent operates on
your behalf. You teach it by setting up rules, answering the questions it
asks, and correcting its mistakes — all of that is captured in files and
commits, so the box's behavior is inspectable and versioned like any other
codebase.

beebox ships as an npm-style package: your box is a small Node package
that depends on `beebox` as a library, plus a code-free operational
directory the agent actually lives in. This keeps "the engine" (this
package, upgraded independently) cleanly separated from "your data" (the
box's cards, config, and runtime state).

## Five-minute start

Distribution is currently a prebuilt tarball (npm publish is planned but not
live yet — see [`docs/implemented-plans/boxes-as-packages-v2.md`](docs/implemented-plans/boxes-as-packages-v2.md)
for the roadmap). Given a tarball URL or path:

```bash
mkdir my-box && cd my-box
pnpm dlx --package=<beebox tarball> bbx engine init .
pnpm install
pnpm exec bbx engine serve
```

`bbx engine init` scaffolds the box in that one directory: the package
(`package.json`, `tsconfig.json`), the root `AGENTS.md`, the operational areas,
default procedures and guides, generated agent docs, and an initial git commit.
The `pnpm install` resolves the real dependency `bbx engine init` just wrote.
`bbx engine serve` then boots a local server for the box; open the printed URL
in a browser.

From here, open a Claude Code or Codex session in the box directory (or point
your existing setup at it) and start talking to it — it already knows how to
use itself.

## Box anatomy at a glance

```
my-box/                    the box: one root, also its npm package and git repo
├── .beebox/box.json        marker (shapeVersion 3) and generated agent guide
├── AGENTS.md               the agent's instructions; includes the agent guide
├── package.json            declares a "beebox" dependency; private
├── node_modules/           gitignored; also holds the engine's reference docs
├── src/
│   ├── schemas/            box-local card-type definitions (optional)
│   ├── views/              custom view definitions (optional)
│   └── tricks/             agent-authored scripts (optional)
├── _content/               the boxholder's content: cards and folders
├── _config/                box configuration, procedures, guides
├── _bookkeeping/           machine working state and archives
├── _publish/               publication output
└── _tmp/                   scratch (gitignored)
```

Folders under `_content/` and the `src/` directories may carry their own
`AGENTS.md`; see [box layout](docs/box-layout.md) for the full vocabulary.

`src/schemas`, `src/views`, and `src/tricks` are the only places the box's own
agent may add code, importing exclusively from the `beebox` package
(`beebox/cards`, `beebox/schema`, `beebox/view-widgets`). `package.json`,
`node_modules`, and lockfiles belong to whoever operates the box, not to the
agent. `_content/` is a plain directory of Markdown cards with YAML frontmatter
that the agent reads, writes, and moves as it works.

Upgrading the engine (bumping the `beebox` dependency and running data
migrations) is `bbx engine upgrade`, run from the box root.

## What leaves your machine

Your box's files stay on your machine, but the agent that operates them
runs on Anthropic's API — every agent turn sends its working context
(your prompts, and whatever cards or emails the agent reads during the
turn) to Anthropic, billed against your Claude subscription. Voice goes
to a transcription vendor (Mistral by default; configurable). If you pick a
non-Claude model (an OpenRouter model you added, or GLM), those turns go to
OpenRouter or Z.ai instead, and your OpenRouter account's privacy settings
decide which hosts see them. Connect
Google or Telegram and those sync in both directions. Quick chat sends your
message and bounded conversation context to TypeSafe through OpenRouter to
choose a destination. Each wakeup pushes
the box's git history to whatever remote you configured — and nowhere
else. Bee Box itself sends no telemetry or analytics. The Claude Code CLI it
runs sends Anthropic usage metrics on Claude models unless you turn that off
in Admin → Agent engine and model.

The full accounting — every endpoint, credential, and egress point, and
what the agent can actually do — is in [the security overview](docs/security-overview.md).

## Where to go next

- [`docs/box-layout.md`](docs/box-layout.md) — the full on-disk layout reference
- [`docs/cards/format.md`](docs/cards/format.md) — the card format
- [`docs/cards/schemas.md`](docs/cards/schemas.md) — adding a new card type
- [`docs/server/boxes.md`](docs/server/boxes.md) — provisioning a box behind a multi-box hub
- [`docs/cards/migrations.md`](docs/cards/migrations.md) — the data-migration runbook
- [`docs/implemented-plans/boxes-as-packages-v2.md`](docs/implemented-plans/boxes-as-packages-v2.md) — the design behind the package layout and the multi-box hub
