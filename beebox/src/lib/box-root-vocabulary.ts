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
  { name: "src", kind: "tooling" },
  { name: ".beebox", kind: "tooling" },
  { name: "README.md", kind: "tooling" },
] as const satisfies readonly BoxRootVocabularyEntry[];
