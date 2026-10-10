# Plugins

Each subdirectory is one plugin: a typed in-repo library a box uses through
stubs (`docs/implemented-plans/plugins.md`). `plugin.ts` default-exports a
`PluginDefinition` (`src/cards/plugin-definition.ts`); an optional `view.tsx`
is the browser-safe view module. Both are published as
`beebox/plugins/<name>` and `beebox/plugins/<name>/view`. The registry is
`src/plugins.ts`.

A plugin file may import only `src/exports/*`, `src/cards/plugin-definition.ts`,
its own directory, and external packages; `view.tsx` and what it reaches may
not import Node builtins (`pnpm layout-check`, rule `plugin-imports`).
