---
title: "Plugins — design notes: what a Bee Box plugin would be, if anything"
status: draft
workstream: plugins-planning
issues:
  - ../../../issues/exploration/2026-08-19-plugins-and-the-medium-content-line.md
  - ../../../issues/exploration/2026-09-24-agent-plugins-spec.md
  - ../../../issues/exploration/2026-05-11-canonical-wisdom-corpus.md
---
# Plugins — design notes

**These are notes for a discussion. This is not a plan.** No implementation is
authorized. The ask is one decision: which direction in section 4, or none.

Sources: the [medium/content issue](../../../issues/exploration/2026-08-19-plugins-and-the-medium-content-line.md)
and its TiddlyWiki and Omi findings, the
[Agent Plugins spec review](../../../issues/exploration/2026-09-24-agent-plugins-spec.md),
two new research notes on
[OpenClaw plugins](../../../research/openclaw-hermes/deep-openclaw-plugins.md) and
[Hermes plugins](../../../research/openclaw-hermes/deep-hermes-plugins.md)
(2026-10-09), the [Imbue Studio template review](../../../research/imbue-studio/starter-templates.md),
and a code survey of this repository (section 2).

## 1. What OpenClaw and Hermes do, and what it cost them

Both are chat-first agents with an in-process code plugin API. Both opened a
registry in 2026. Both now steer authors away from code.

| | OpenClaw (2026.9.9) | Hermes (v0.21.6) |
|---|---|---|
| Unit | npm package + `openclaw.plugin.json` (validated before code loads) | directory + `plugin.yaml` + Python `register(ctx)` |
| API | 60 `register*` methods, ~45 typed hooks, two exclusive slots | ~45 `PluginContext` methods, ~25 hooks, 4 middleware kinds, ~10 provider ABCs |
| Can add | providers, channels, tools, slash/CLI commands, scheduler jobs, HTTP routes, Control UI pages, memory/context engines, skills | tools, platforms, hooks, slash/CLI commands, dashboard tabs, desktop panes, providers, memory, skills, `ctx.llm` |
| Trust | in-process, "not sandboxed"; consent hash over the declared surface; per-hook grants | in-process, "full agent privileges"; capability consent "not a sandbox"; opt-in out-of-process host since Oct 2026 |
| Distribution | ClawHub (skills and npm plugins); `plugins install clawhub:|npm:|git:` | `plugin-catalog/` YAML in the main repo, exact SHA, human-merged; 522 entries |
| Versioning | all APIs "experimental"; compat registry with 3-month windows | behaviour contract, additive only, no API version number |

What happened:

- **The code API is the cost.** OpenClaw broke third-party channel plugins
  in March, July and October 2026 despite a formal deprecation registry. Hermes
  delisted 11 catalog plugins in one week for monkeypatching core, and a
  September module split hard-broke every plugin importing internals. Every
  seam a plugin wants and does not have becomes a patch.
- **People write prose, not code.** ClawHub: about 13.7k skills against 2.4k
  plugins, and 22 of the 25 most-downloaded plugins are first-party. The
  third-party code plugins with traction are channels and policy filters.
  Hermes's catalog is a quarter desktop UI shims and a tenth memory providers.
- **A registry becomes a scanning programme.** ClawHavoc (Feb 2026): 341 of
  2,857 audited skills were malicious, by telling the human to paste a script.
  The publish gate was a week-old GitHub account. Hermes avoided a service:
  its catalog is YAML in the repo with a kill list.
- **Both converged on "bundle first".** OpenClaw installs Agent Plugins, Claude
  and Codex layouts as content packs "without importing runtime code" and its
  vision doc now says prefer that. Hermes packs are pin lists: "nothing new
  exists at runtime".
- **Agents author data.** Hermes's self-improvement loop writes only skills.
  Neither system has an agent-authored plugin path.

## 2. Bee Box's extension surface today

Verified in code 2026-10-09. The standing position is
[extensibility.md](../design/extensibility.md): "knowledge, not plugins", where
"no plugins" means no registry, marketplace, or lifecycle framework. The
boxes-as-packages plan noted `pnpm add some-box-plugin` as enabled by the
layout and out of scope.

| Piece | Lives in the box at | Author | Reload | Checked by | Runs | Distributed by |
|---|---|---|---|---|---|---|
| Card schema | `src/schemas/<type>.ts` | box agent | hot (server watcher) | `isCardSchema`, `bbx validate`, box `tsc` | in-process, server and CLI; may override a built-in type | hand-authored |
| View | `src/views/*.tsx` | box agent | hot | `bbx view lint/typecheck/check`, markdown AST lint, meta import in a killed subprocess | browser, main app origin, no iframe; props are the capability set | hand-authored |
| Trick | `src/tricks/scripts/<name>/` | box agent | per run | `--check-secrets`; no typecheck | subprocess, allow-listed env, declared secrets, no OS sandbox; commits whole tree | hand-authored |
| Procedure | `_config/procedures/*.procedure.card` | engine templates and box | per run | schema | shell steps and agent steps | template sync with parked updates |
| Schedule | `_config/schedules/*.scheduled-script.card` | engine templates and box | per tick | schema; `enabled` is box-owned | shell with connector credentials | template sync |
| Skill | `.claude/skills/<name>/SKILL.md` | engine (marked) and box (unmarked survive prune) | per session | none | prompt | managed list in `guidance-sync/skills.ts` |
| Rules, guides, personality, briefing | `.claude/rules/`, `_config/*.guide.card`, … | engine families and box | per session | schema for cards | prompt | template sync and generation |
| Landmark | `*.landmark.card` | box | hot | schema | navigation, triage destinations, `expand` | hand-authored |
| Agent hooks and settings | `.claude/settings.json` | engine installs validate hook; box may add | per session | none | the SDK loads only the `project` source | engine install |

Closed registries, engine-compiled, not box-reachable: connectors (4),
Markdoc tags (18, including 6 recipe tags), named views, collections (todos
only), job types, renderers, pre-actions, adapters, CLI verbs, tRPC routers.
No MCP in either direction. The only things called "plugins" in the tree are
the two agent-harness plugins under `plugins/` that install the validate hook.

Two facts bear on the design more than the rest:

- **The box is already a package and the boundary is already a plugin API.**
  A box depends on `beebox` with a `^version` pin, imports only
  `beebox/{cards,schema,view-widgets}`, and `bbx upgrade` moves the pin,
  runs migrations, syncs templates, and typechecks in one commit.
- **Templates already implement overlay with parked updates.**
  `installTemplateFile` overwrites a file that still matches stock, 3-way
  merges a changed one, and parks the rest under `_config/_template-updates/`.
  The boxholder decided (2026-09-19) that a box agent merges a parked guide.
  This is the "schema stub the agent extends" mechanism, already built.

The test case for any direction is **recipes**: a schema, a frontend renderer,
and six Markdoc tags in a closed registry. If a bundle cannot ship a recipe
type that works as well as the built-in, the medium/content line cannot move
anything that has a renderer or a tag. Education is the other candidate
(`course`, `lesson-plan`, `exposition-plan`, `progress`, the managed
`build-course` skill, and the exposition-rules compiler in core).

## 3. Where a plugin sits relative to these

Not a new runtime kind. Both competitors show the in-process code API is the
expensive part, and Bee Box already compiles that layer (connectors, tags,
renderers) into the engine on purpose. The only candidates left are:

- a **bundle** of several existing pieces with one name, or
- a **distribution mechanism** for what boxes already author,

and the directions below differ mainly in how much of each they are.

## 4. Candidate directions

### A. No plugin system. Boxes author; we distribute starters and knowledge.

Keep extensibility.md as written. Serve the "easy way to start" decision with
the [starter manifest](../../../issues/features/2026-10-08-starter-manifest-and-scripted-first-turn.md):
a starter is cards, views, schedules and a briefing applied to an existing
box through the template mechanism. Serve "how do people usually track
books?" with the [wisdom corpus](../../../issues/exploration/2026-05-11-canonical-wisdom-corpus.md)
as documents. Sharing personal work is copying files.

- For: zero new concepts; matches what the evidence says people use (prose
  at a hook). Starters already need most of the machinery a bundle would.
- Against: the box has no named place where its own extension goes, so
  extraction stays archaeology. Nothing moves out of core. A starter and a
  "plugin" would be two names for one thing if a starter ever ships a schema.

### B. A plugin is a named bundle of existing pieces, installed by copy. (Recommended.)

A plugin is a directory mirroring the box's extension paths (`src/schemas/`,
`src/views/`, `src/tricks/scripts/`, `_config/procedures/`, `_config/schedules/`,
`.claude/skills/`, docs) plus one manifest naming what it contributes and the
`beebox` range it was built against. Install copies the pieces into the box
through `installTemplateFile`, tracked per plugin the way stock templates are
tracked today: a piece the box has not edited updates in place; an edited
piece gets a 3-way merge or parks. The box's own copy always wins. Nothing new
exists at runtime; the loaders are the ones in section 2.

Every box has one plugin of its own from the start, which is the manifest for
the pieces the box authored. Extraction is `bbx plugin export <name>`: pick
pieces, copy them out with the manifest, strip nothing automatically.
Distribution is a directory or a git remote. No registry; if a list is ever
wanted, it is YAML in this repo with a kill list, as Hermes does.

- For: the boxholder's 2026-09-24 list (docs, a trigger skill, command-line
  tools, maybe views, schema stubs) is exactly a bundle of existing pieces.
  Parked templates already solve the stub-the-agent-extends problem. A
  starter is the same object with cards in it. One manifest gives the box a
  place for extension and a listing of what it changed.
- Against: a bundle can only ship what a box can author, so recipes cannot
  move out of core until Markdoc tags and renderers are box-authorable (or a
  box view replaces the renderer). The manifest and `bbx plugin` verbs are
  new surface. Copying means two boxes with the same plugin drift; that is
  also what makes box edits safe.

### C. A plugin is an npm dependency of the box package.

`pnpm add` the plugin into the box; the engine discovers schemas, views,
skills and procedures from `node_modules/<plugin>/` as a second, lower
precedence source. Updates are version bumps; the box never edits plugin
files, it shadows them by same-name pieces of its own.

- For: real versioning and a peer range on `beebox`; no copy drift; the
  boxes-as-packages layout left room for it.
- Against: `beebox` is not on npm, so a peer range has nothing to resolve
  against yet. A second discovery source is what Hermes's precedence rules,
  impostor check and one CVE came from. The agent cannot edit a stub in
  `node_modules`, so "stub the agent extends" becomes "shadow the whole
  file". The engine needs new loaders for every piece kind. This is a real
  plugin system, and nothing in the evidence says Bee Box needs one before a
  second party writes a plugin.

### Rejected: an in-process code API (OpenClaw and Hermes's shape).

Hooks, provider registration, new connectors or tags from a plugin. Both
research notes reject it for Bee Box: a quarterly third-party break, a
documented "not sandboxed" boundary, and breadth (providers, channels) Bee
Box does not want. Connectors and tags stay engine source changes.

## 5. Recommendation

Direction B, scoped small, and treated as the mechanism behind starters rather
than a parallel feature:

1. **One object, two names.** A starter is a plugin that ships cards. Decide
   the manifest once for both (the starter issue and this one merge).
2. **Additive first.** Nothing moves out of core in the first slice. The first
   plugin is extracted from a real box (the lending journey
   walk produced a card type and a view on 2026-10-08), not carved out of the
   engine.
3. **Reuse the tracker.** Plugin installs record into the same
   `_config/template-versions.json` mechanism, keyed by plugin, so parked
   updates, `bbx template diff/accept/resolve`, and the health check work
   unchanged.
4. **Per-subsystem line, written down.** The issue asks for a decision per
   subsystem. First cut, to argue with:
   - Medium (stays): card format and intake types (doc, memo, file, image,
     audio, pdf, webpage, email, chat, Drive), capture, questions, landmarks,
     navigation, dashboard, personality and guides, search, git, scheduler,
     procedures, publication, views runtime and widgets, speech and listening.
   - Content (plugin candidates, in order of coupling): inventory (schema
     only); education (schemas, a managed skill, a rules compiler); recipes
     (schema, renderer, six tags, so last).
5. **Trust stays where it is.** A plugin's pieces are the same kinds the box
   agent may author and run under the same checks. Until a bundle from
   outside the boxholder's own repos is installed, no scanner and no consent
   screen; record both as later, per the research notes.
6. **Revise extensibility.md** to name the bundle and keep its prohibition:
   no registry, no marketplace, no lifecycle framework.

What B does not settle, and would be the plan's first design questions:
the manifest format (borrow Agent Plugins' rules, not its envelope), whether
the box's own manifest is a card, and whether `bbx plugin export` strips
anything or only lists what it copied.

## 6. Questions only the boxholder can answer

1. **Is "every box starts with its own plugin" still the idea to design
   around**, or is export-on-demand from a plain box enough? The first adds a
   manifest to every box; the second adds a verb.
2. **Are a starter and a plugin one thing?** If yes, the starter issue folds
   into this plan. If no, say what a starter may contain that a plugin may
   not, or the reverse.
3. **Does anything move out of core in the first year?** If recipes and
   education stay built-in regardless, the plugin is purely additive and the
   medium/content line is documentation, not migration.
4. **Which real box piece is the first export?** The lending index card type
   and view from the 2026-10-08 journey walk is the candidate in hand.
5. **Directory and git remote only, or npm too?** B can later grow a C-style
   dependency form; deciding "not now" keeps `beebox` off npm.
6. **Does extensibility.md's "no plugins" survive with the word "bundle", or
   should the word "plugin" be avoided in Bee Box altogether?**
