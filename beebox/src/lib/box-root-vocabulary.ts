/**
 * The closed vocabulary of legal box-root entries (shapeVersion 3). Split
 * out of `box-layout-spec.ts` purely to keep that file under the 300-line
 * limit — see `box-layout-spec.ts` for the layout spec itself.
 *
 * Data only here — a later track (`bbx validate`/`bbx status`'s root check)
 * reads this to flag anything else at the root. `"area"` entries are every
 * `BOX_LAYOUT` path's first segment; `"tooling"` is everything else a v3
 * root legitimately carries.
 */

import type { BoxRootVocabularyEntry } from "./box-layout-types.js";

export type { BoxRootVocabularyEntry } from "./box-layout-types.js";

export const BOX_ROOT_VOCABULARY = [
  // Underscore areas — every `BOX_LAYOUT` path's first segment.
  { name: "_content", kind: "area" },
  { name: "_config", kind: "area" },
  { name: "_bookkeeping", kind: "area" },
  { name: "_publish", kind: "area" },
  { name: "_tmp", kind: "area" },

  // npm/tooling and agent-identity entries.
  { name: "package.json", kind: "tooling" },
  { name: "pnpm-lock.yaml", kind: "tooling" },
  { name: "package-lock.json", kind: "tooling" },
  { name: "tsconfig.json", kind: "tooling" },
  { name: "node_modules", kind: "tooling" },
  { name: ".git", kind: "tooling" },
  { name: ".gitignore", kind: "tooling" },
  { name: ".gitattributes", kind: "tooling" },
  { name: "CLAUDE.md", kind: "tooling" },
  { name: ".claude", kind: "tooling" },
  // The Codex-facing mirror of the two above: `AGENTS.md` is a symlink to
  // `CLAUDE.md`, `.agents/` and `.codex/` hold Codex-mirrored skills and hook
  // config — all planted at the box root by `agent-context-mirrors.ts`
  // alongside the Claude-facing originals.
  { name: "AGENTS.md", kind: "tooling" },
  { name: ".agents", kind: "tooling" },
  { name: ".codex", kind: "tooling" },
  { name: "src", kind: "tooling" },
  { name: ".beebox", kind: "tooling" },
  { name: "README.md", kind: "tooling" },

  // Runtime state dotfiles a running box legitimately writes at its root —
  // not relocated under an underscore area, because they describe the
  // *process*, not box content (`bbx serve`'s PID; the reactor's
  // cross-process lock). `.bbx-lock` is NOT listed: that's the retired v2
  // reactor-lock filename (renamed to `.bbx-reactor.lock`) — v3 never writes
  // it, `one-root-run.ts`'s migration cleans up a leftover one, and a stray
  // one on a v3 box is correctly still a stray.
  { name: ".bbx-serve.pid", kind: "tooling" },
  { name: ".bbx-maps-state.json", kind: "tooling" },
  { name: ".bbx-reactor.lock", kind: "tooling" },
  // The boxholder's maps-precheck ignore patterns (`core/maps/precheck-ignore.ts`
  // reads it at the box root, and the one-root migration rewrites a v2 one
  // there in v3 form). Missing from this list, it made the pre-commit root
  // check refuse every commit on a migrated production box that had one
  // (2026-09-05).
  { name: ".bbx-maps-ignore", kind: "tooling" },
] as const satisfies readonly BoxRootVocabularyEntry[];
