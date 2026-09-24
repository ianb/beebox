---
title: "Learn from the Agent Plugins spec (agent-plugins.org) for box plugins"
workstream: unattached
area: beebox
labels: [plugins, architecture]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder found agent-plugins.org, 2026-09-24
---

The boxholder found [Agent Plugins](https://agent-plugins.org/), an open,
vendor-neutral format for packaging agent extensions. The boxholder doubts
that beebox wants this format. The purpose here is to learn from its choices,
not to adopt it.

Related plugin issues:

- [Plugins and the medium/content line](2026-08-19-plugins-and-the-medium-content-line.md):
  the design this informs, including the idea that every box starts with its
  own plugin.
- [Canonical wisdom corpus (in lieu of plugins)](2026-05-11-canonical-wisdom-corpus.md):
  the counter-position that an agentic system needs shared knowledge more
  than installable code.
- [Claude Code Mods](2026-09-18-claude-code-mods.md): Claude Code's own plugin
  format (`.claude-plugin/plugin.json` plus hooks), which is a different
  layout from this spec's root `plugin.json`.

## Research (2026-09-24)

Source: [agent-plugins-spec repository](https://github.com/agentplugins/agent-plugins-spec),
`spec/1.0.0.md` (published); a 1.1.0 working draft exists. The initial steering
committee has core maintainers from Amazon, Cursor, Microsoft, OpenAI, and
Vercel. Anthropic is not listed.

**Format (v1.0.0).** A plugin is a directory:

- `plugin.json` (required). It has `$schema` (versioned, immutable URL) and
  `name` (1–64 characters, lowercase, hyphens and periods). Optional:
  `version` (semver recommended), `description`, `author`, `homepage`,
  `repository`, `license`, `keywords`, and `extensions`. The schema is closed,
  but the client reports and ignores unknown top-level fields.
- `skills/<name>/SKILL.md`: Agent Skills, found by directory layout only.
- `mcp.json`: `mcpServers`, a closed union of `stdio`, `streamable-http`, and
  legacy `sse`. Stdio servers get `PLUGIN_ROOT` and `PLUGIN_DATA` (a
  client-managed writable directory that survives updates). Only those two
  placeholders are expanded, and only in `args`, `env`, and `cwd`.
- Client-specific parts use a reverse-domain namespace, either as a key under
  `extensions` in `plugin.json` or as a top-level directory (for example
  `com.example.client/`). A client ignores namespaces it does not implement.

**Rules worth noting.** All paths are `./`-relative and must stay inside the
plugin root after symlink resolution. An invalid manifest rejects the plugin.
An invalid component is skipped and the rest loads. Credentials in `env`,
`headers`, or `url` are forbidden; authorization is the client's job. HTTP is
allowed only for localhost.

**Out of scope in v1:** commands, hooks, agents, rules, and other component
types ("too client-specific"); archives; registries and install; sandboxing;
OAuth. Future considerations: permission declarations and consent,
signatures/provenance, secret injection, enterprise allow/block lists,
audit events, inter-plugin dependencies, and a validator.

## How it maps to beebox

A box already holds extension pieces in several places: box-local schemas
(`src/schemas/`, `_config/schemas/`), views (`src/views/`), procedures
(`_config/procedures/`), tricks (`src/tricks/`), and managed box skills
written to `<box>/.claude/skills/` (`beebox/src/core/box/skills.ts`). Only
skills and MCP servers are portable in this spec. Everything that makes a box
plugin a beebox plugin (schemas, views, procedures, templates, guidance) would
live in a reverse-domain extension directory that only beebox reads.

## What to learn from it

- **Adopt the envelope.** `plugin.json`, `skills/`, and `mcp.json` as
  specified, with beebox parts in a namespaced directory. The benefits: a
  known shape, skills that other agents can also load, and a manifest and path
  rules we do not have to invent (the minimize-invented-concepts preference).
  The cost: most of a beebox plugin stays beebox-only anyway.
- **Borrow the rules, not the format.** Take only closed-schema-but-tolerant
  loading, root containment, skip-invalid-components, no credentials in the
  package, and a `PLUGIN_DATA`-style state directory.
- **Wait.** v1 is new, and the parts we care about (permissions, dependencies,
  secrets) are all future work. Claude Code, the primary box agent runtime, has
  its own plugin format, and the spec does not say whether that format is
  converging with this one. Check that before deciding.

The lean is to borrow the rules. The evaluation belongs with the design of
the medium/content plugins issue, not before it.

## Examples and verdict (2026-09-24)

The boxholder's verdict after reviewing the surface: "not very interesting."
The portable surface is instructions plus MCP. The only executable part is an
MCP server, and the spec does not sandbox it.

Real examples are thin:

- The official [agent-plugins-example](https://github.com/agentplugins/agent-plugins-example)
  contains one skill, `migrate-agent-plugin`, whose `references/` holds a
  migration guide and checklist. Its advice is additive: add a root
  `plugin.json` beside existing platform files and delete nothing.
- [antonbabenko/agent-plugins](https://github.com/antonbabenko/agent-plugins)
  ships parallel manifests per client (`.claude-plugin`, `.agents/plugins`,
  `.kiro/plugins`). Only the `SKILL.md` files are shared. Commands and
  subagents are client-specific.
- The client-extensions page shows only a placeholder
  (`com.example.client/hooks/hooks.json`) and names no real client namespace.

In practice the ecosystem converges on `SKILL.md`, not on the plugin
envelope. What the boxholder wants a beebox plugin to carry is recorded in
[plugins and the medium/content line](2026-08-19-plugins-and-the-medium-content-line.md).
