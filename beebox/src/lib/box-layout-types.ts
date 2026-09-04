/**
 * Types for the box directory layout spec. Split out of `box-layout-spec.ts`
 * (which holds the `BOX_LAYOUT` data) purely to keep that file under the
 * 300-line limit — see `box-layout-spec.ts` for what this all is for.
 */

/** Which section of `docs/box-layout.md` (and, for a subset, the agent guide) an entry belongs under. */
export type BoxLayoutArea = "content" | "bookkeeping" | "config" | "publish" | "tmp" | "tricks" | "agent-config";

export interface BoxLayoutEntry {
  /** Path relative to the box root (the one root — see `docs/box-layout.md`). */
  path: string;
  /**
   * Key this entry is exposed as on `BOX_DIRS`, for directories canonical
   * code resolves via `getBoxDir()`/`BOX_DIRS.<key>`. Omitted for directories
   * that are documented but not (or not yet) wired into `BOX_DIRS` — see the
   * `"legacy"` area entries in `box-layout-spec.ts`.
   */
  boxDirsKey?: string;
  /** Section this entry renders under. */
  area: BoxLayoutArea;
  /** Developer-facing description, used in `docs/box-layout.md`'s tables. */
  description: string;
  /**
   * Shorter, agent-facing phrasing for the in-box agent guide's directory
   * table. Only set for entries the agent guide actually surfaces — most
   * `config`/`tricks`/`agent-config` entries aren't in that table at all.
   */
  agentDescription?: string;
}

/**
 * One legal entry at the box root — the closed vocabulary later tracks
 * validate against (`bbx validate`/`bbx status`'s root check). `"area"` is
 * one of the underscore-prefixed directories in `BOX_LAYOUT`'s area list
 * (`_content`, `_config`, `_bookkeeping`, `_publish`, `_tmp`); `"tooling"` is
 * everything else a v3 root legitimately carries (the npm namespace, agent
 * identity, runtime state, code).
 */
export interface BoxRootVocabularyEntry {
  /** The literal root entry name (e.g. `"_content"`, `"package.json"`). */
  name: string;
  kind: "area" | "tooling";
}
