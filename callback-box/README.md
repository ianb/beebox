# callback-box

callback-box is a personal assistant and operating system built on Claude Code. You
give it inputs — voice memos, emails, web clippings, chat messages — an agent
processes them, and the system takes actions or asks questions. There's no
separate database: the filesystem is the state, Git is the history, and the
`cb` CLI is the universal interface to a single operational directory called
a **box**.

It isn't an app you use so much as a system a Claude Code agent operates on
your behalf. You teach it by setting up rules, answering the questions it
asks, and correcting its mistakes — all of that is captured in files and
commits, so the box's behavior is inspectable and versioned like any other
codebase.

callback-box ships as an npm-style package: your box is a small Node package
that depends on `callback-box` as a library, plus a code-free operational
directory the agent actually lives in. This keeps "the engine" (this
package, upgraded independently) cleanly separated from "your data" (the
box's cards, config, and runtime state).

## Five-minute start

Distribution is currently a prebuilt tarball (npm publish is planned but not
live yet — see [`docs/implemented-plans/boxes-as-packages-v2.md`](docs/implemented-plans/boxes-as-packages-v2.md)
for the roadmap). Given a tarball URL or path:

```bash
mkdir my-box && cd my-box
pnpm dlx --package=<callback-box tarball> cb init .
pnpm install
pnpm exec cb serve content
```

`cb init` scaffolds the package (`package.json`, `tsconfig.json`, a thin
`CLAUDE.md`) and the box itself under `content/` — directories, default
procedures and guides, generated agent docs, and an initial git commit. The
`pnpm install` resolves the real dependency `cb init` just wrote. `cb serve`
then boots a local server for the box; open the printed URL in a browser.

From here, open a Claude Code session at `content/` (or point it at the box
in your existing setup) and start talking to it — it already knows how to
use itself.

## Box anatomy at a glance

```
my-box/                    the package — coding surfaces live here
├── package.json           declares a "callback-box" dependency; private
├── node_modules/           gitignored
├── CLAUDE.md               thin: this is a box package; the box is content/
├── src/
│   ├── schemas/            box-local card-type definitions (optional)
│   ├── views/              custom view definitions (optional)
│   └── tricks/             agent-authored scripts (optional)
└── content/                THE BOX — the operational root, no package.json inside
    ├── .cb-box             marker file
    ├── CLAUDE.md           the operating agent's context
    ├── box/  store/  config/  people/  places/  docs/  procedure/
    └── ...
```

The package root is a coding surface: `src/schemas`, `src/views`, and
`src/tricks` are the only places the box's own agent may add code, importing
exclusively from the `callback-box` package (`callback-box/cards`,
`callback-box/schema`, `callback-box/view-widgets`). Everything else at the
package root — `package.json`, `node_modules`, lockfiles — belongs to
whoever operates the box, not to the agent. `content/` is the box: a plain
directory of Markdown cards with YAML frontmatter that the agent reads,
writes, and moves as it works. See [`docs/box-layout.md`](docs/box-layout.md)
for the full directory reference.

Upgrading the engine (bumping the `callback-box` dependency and running data
migrations) is `cb upgrade`, run from the package root.

## Where to go next

- [`docs/box-layout.md`](docs/box-layout.md) — the full on-disk layout reference
- [`docs/cards-as-markdown.md`](docs/cards-as-markdown.md) — the card format
- [`docs/adding-schemas.md`](docs/adding-schemas.md) — adding a new card type
- [`docs/adding-a-box.md`](docs/adding-a-box.md) — provisioning a box behind a multi-box hub
- [`docs/migrations.md`](docs/migrations.md) — the data-migration runbook
- [`docs/implemented-plans/boxes-as-packages-v2.md`](docs/implemented-plans/boxes-as-packages-v2.md) — the design behind the package layout and the multi-box hub
