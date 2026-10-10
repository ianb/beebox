---
title: "Plugins — design notes: a typed library the box extends through stubs"
status: implemented
workstream: plugins-planning
issues:
  - ../../../issues/closed/exploration/2026-08-19-plugins-and-the-medium-content-line.md
  - ../../../issues/closed/exploration/2026-09-24-agent-plugins-spec.md
  - ../../../issues/exploration/2026-05-11-canonical-wisdom-corpus.md
---
# Plugins — design notes

**Design notes from a discussion with the boxholder, 2026-10-09.** Items
marked **DECIDED** record a boxholder statement. Items marked **OPEN** wait
for one. The plan is [plugins.md](plugins.md).

Sources: the [medium/content issue](../../../issues/closed/exploration/2026-08-19-plugins-and-the-medium-content-line.md),
the [Agent Plugins spec review](../../../issues/closed/exploration/2026-09-24-agent-plugins-spec.md),
the research notes on [OpenClaw plugins](../../../research/openclaw-hermes/deep-openclaw-plugins.md)
and [Hermes plugins](../../../research/openclaw-hermes/deep-hermes-plugins.md),
the [Imbue Studio templates](../../../research/imbue-studio/starter-templates.md),
and a code survey of this repository (section 2). The first version of these
notes compared three directions; the discussion replaced them with the one in
section 3. The research is unchanged.

## 1. What OpenClaw and Hermes taught

Both are chat-first agents with an in-process code plugin API (60 and ~45
registration methods, dozens of hooks). Both opened a registry in 2026. Both
now steer authors to "bundles": content packs with no runtime code.

- **The code API is the cost.** OpenClaw broke third-party channel plugins in
  March, July and October 2026 despite a formal deprecation registry. Hermes
  delisted 11 plugins in one week for monkeypatching core; a module split
  hard-broke every plugin importing internals.
- **People write prose, not code.** ClawHub: about 13.7k skills against 2.4k
  plugins; 22 of the 25 most-downloaded plugins are first-party.
- **A registry becomes a scanning programme.** ClawHavoc: 341 of 2,857
  audited skills were malicious. Hermes kept its catalog as YAML in the repo.
- **Agents author data.** Neither has an agent-authored plugin path.
- **npm has no plugin discovery.** Hosts either list plugins in config
  (ESLint, Vite; Prettier 3 removed its node_modules scan), scan for a marker
  (Homebridge), or read a manifest in `package.json` (VS Code, OpenClaw).
  The trend is explicit listing.

## 2. Bee Box's extension surface today

Verified in code 2026-10-09. Standing position:
[extensibility.md](../design/extensibility.md), "knowledge, not plugins",
where "no plugins" means no registry, marketplace, or lifecycle framework.
That prohibition survives this design.

| Piece | Lives at | Author | Checked by | Runs |
|---|---|---|---|---|
| Card schema | `src/schemas/<type>.ts` | box agent | `bbx validate`, box `tsc` | in-process; a same-name box type overrides a built-in |
| View | `src/views/*.tsx` | box agent | `bbx view lint/typecheck/check` | browser, main origin; esbuild bundles from the box's node_modules, shims only `react` and `beebox/view-widgets` |
| Trick | `src/tricks/scripts/<name>/` | box agent | `--check-secrets` | subprocess, allow-listed env, declared secrets, commits with a trailer |
| Procedure, schedule | `_config/procedures/`, `_config/schedules/` | engine templates and box | schema | shell and agent steps |
| Skill | `.claude/skills/<name>/SKILL.md` | engine (DOCID-marked, regenerated) and box (unmarked, kept) | none | prompt; points at `node_modules/beebox/box-docs` |
| Guidance | `AGENTS.md`, nested `AGENTS.md`, guides, personality | box; engine keeps include lines | schema for cards | prompt |

Closed, engine-compiled registries: connectors (4), Markdoc tags (18, one
global table), named views, collections, job types, renderers, adapters, CLI
verbs. Health checks are one function pushing fifteen checks. No MCP.

Facts the design rests on:

- `cardSchema(type, config)` takes the type name separately from the config,
  so a config without a type is already an abstract base.
- `beebox/cards` exports `cardSchema`, `body` and types, not the built-in
  configs. A box can replace a built-in type, not extend it.
- A box is a package depending on `beebox` with a `^version` pin;
  `bbx upgrade` moves the pin, runs migrations, syncs templates and
  typechecks in one commit.
- The template tracker already does overlay with 3-way merge and parked
  updates for data files.

## 3. The design

**DECIDED.** A plugin is a **typed library** the engine ships, which a box
uses through **small box-owned stubs** that import and extend it. Nothing new
exists at runtime: the loaders are the ones in section 2.

### Three tiers, nothing else

- **Instruction.** A service the agent can simply call (omdb, tmdb) is a
  documentation entry, not a plugin. It is consumed, not integrated.
- **Trick.** A script that integrates with nothing is a well-structured
  trick the docs point at; the agent installs it by copying into
  `src/tricks/scripts/`. No listing.
- **Plugin.** A listed, typed library, for what the engine must know about: a
  type it validates, a view, a script with declared secrets, a connector
  wakeup must run, a health check.

### What a plugin is

In-repo: `beebox/src/plugins/<name>/`, reached only through the public
subpath `beebox/plugins/<name>`. Its `index.ts` exports one
`definePlugin({ name, description, docs, schemas?, views?, scripts?,
connectors?, healthChecks? })`. The engine reads the declarative parts
without running anything. **DECIDED:** only project-shipped plugins for now;
a user plugin later is a separate package added with friction (a confirmation
flag, a typecheck, an `external` listing `bbx doctor` reports).

**A plugin imports only the public specifiers and its own directory**,
enforced by the layout check and import lint. This is what keeps an in-repo
plugin from being core by another name.

### Installed versus active

Every in-repo plugin is **installed** (it ships with the engine). It is
**active** only when `_config/box.json` lists it. Active means: its skill is
mirrored into `.claude/skills/` as a DOCID-marked copy, its types appear in
the agent guide, its health checks run, its connectors sync, `bbx plugins
list` shows it. Inactive means nothing: unimported code in node_modules.
**DECIDED:** new boxes have nothing active. One standing line in the agent
guide, "other plugins: `bbx plugins list`", is the only trace of inactive
plugins.

### Stubs

Activation is agent-run from the plugin's docs: list the name, write the
stubs the docs ask for. No plugin code runs at activation.

- Schema stub: `cardSchema("recipe", { ...recipeBase, fields: { ...recipeBase.fields, rating } })`.
  The box picks the type name and may add fields. An `extendSchema(base,
  delta)` helper chains `validate` and `summarize` where spread would replace
  them. Built-in types the box should extend get their configs exported as
  bases.
- View stub: re-export the plugin's component as default and declare
  `rendersCardTypes`. Compiles through the existing view compiler.
- Script stub: a trick named `<plugin>-<verb>` that imports the plugin's main;
  `secrets.json` beside it stays the box's.
- Data pieces (a procedure, a skill body, cards) copy through the template
  tracker and park on conflict, as today.

The stub is the box's code. A library update never touches it.

### Markdoc tags

**DECIDED:** tags are local to the type. A schema config declares
`markdocTags`; a card body validates and renders against core tags plus its
type's tags. The global table shrinks to the core vocabulary. A tag that
should be global is a revisit with a concrete case; recipes is not that case.
The frontend half: the `Markdown` widget must accept a type's tag components
so a stubbed view can render them.

### Hooks a plugin may export

Enumerated and typed on the plugin object, each added when a real plugin
needs it: `healthChecks` (read-only), `connectors`. No general event hooks.
**DECIDED:** no derived-rules hook; the exposition rules compiler is dropped
when courseware moves, and course guidance is a nested `AGENTS.md` the agent
writes in the course directory.

### Uninstallation, rot, conflicts

Deactivation removes the name from `box.json`. Stubs stay as box code and
still compile, because the library still ships. The agent decides whether to
delete them. A removed library breaks a stub's import: the schema loader
keeps the last good version and reports it, a view returns the error module,
a trick fails at run. `bbx upgrade` typechecks before committing, so a base
change surfaces on the stub by name. The plugin system owns four health
checks in core: cards of a type with no active plugin, stubs referencing an
inactive plugin, stubs importing a missing module, box typecheck failing.
**DECIDED:** none of this is automatic; it must be loud.

### Migration

**DECIDED:** manual and agent-run. Each plugin's docs carry a Migration
section per engine version naming the script to run. A plugin may ship a
mechanical update script; the docs, not the engine, tell the agent to run it.
The project's rule: never remove a library in the release that adds its
replacement.

### Conventions

An authoring guide at `beebox/docs/plugins.md`, cheap parts enforced: layout,
the import boundary, a description that passes the `brief` lint, a README
with Setup, Scripts, Migration, Uninstall sections, tags on the schema,
read-only health checks, a doctest per plugin that performs its own
documented setup into a throwaway box.

## 4. Candidates

| Plugin | Moves | Coupling to settle | Slice |
|---|---|---|---|
| courseware | `course`, `lesson-plan`, `exposition-plan`, `progress`, `concept-map` and its renderer, `build-course` skill | exposition rules compiler dropped; the node-refs lint binds concept maps to courseware, so they move together | 1 |
| conventions | the authoring guide, its lints, scoped Markdoc tags in the engine | prepares recipes | 2 |
| Gmail connector | the connector | produces the base email types, which stay core | 3 |
| Drive connector | the connector, `gdoc`, `gsheet`, `gfolder`, `glink` | drive handlers registry | 3 |
| Google Calendar connector | the connector | **OPEN:** a generic `calendar-event` type does not exist; new work | 3 or later |
| recipes | `recipe`, six tags, renderer with scaling context | scoped tags; `Markdown` widget accepting tag components | later |
| figures | `figure`, the sketch compile route | p5, three, d3 externals list | later |
| judgment | `judgment`, `bbx judge`, `src/core/judgment/` | a script-heavy plugin | later |

Stays core as medium: inventory (a system interface card with its own tRPC router and pages, not a schema-only type as first assumed), intake types, email and (eventually) calendar base
types, chat, capture, questions, landmarks, navigation, dashboard, settings,
personality, guides, search, git, scheduler, procedures, publication,
browser tasks (infrastructure for research plugins), person, place,
commentary, record, memo, views runtime and widgets, speech and listening.

Removals, filed separately, not plugins: tab arrangements (never reached a
reasonable place), Telegram (a connector and a chat channel; its own issue).

## 5. Open

- **The box's own plugin.** The first issue proposed that every box starts
  with its own plugin as the place extension goes, and that extraction is
  packaging. Under this design the box's extension is its stubs plus the
  `box.json` list, and local modification is how a box uses a plugin rather
  than a plugin in itself. The boxholder inclines against the original idea
  for that reason. See the discussion in the session; not yet decided.
- Whether a generic calendar type comes with the connector slice.
- Which built-in types export bases first.
