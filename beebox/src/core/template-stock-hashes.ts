/**
 * Stock-hash ledger for template files that ship via `installTemplateFile` with
 * a `priorStockHashes` allowlist (the box-local CLAUDE.md guides).
 *
 * GENERATED DATA — do not hand-edit. Run `pnpm template-stock:update` after
 * changing one of these template constants; it moves the superseded hash into
 * `superseded[]` and records the new `current`. A test
 * (`test/core/template-stock-hashes.doctest.md`) fails if a template constant
 * changes without this ledger being updated, which is the forcing function that
 * keeps `priorStockHashes` complete: a field box carrying ANY superseded version
 * is then recognized as unmodified stock and cleanly overwritten on `bbx init`
 * (rather than silently parking under `config/_template-updates/`).
 *
 * `current` is the sha256 of the live template constant; `superseded` is every
 * hash we ever shipped before it (this is what `installTemplateFile` receives as
 * `priorStockHashes`).
 */

export interface TemplateStockEntry {
  /** sha256 of the current template constant (what a fresh box gets). */
  current: string;
  /** sha256s of every prior shipped version — passed as `priorStockHashes`. */
  superseded: string[];
}

export const TEMPLATE_STOCK_HASHES = {
  "briefing-seed": {
    current: "ef850476650452469d989cb94c85d1d8b1fa10eee32d3568930cbb12d15489cc",
    superseded: [
      "4e5fc48a9fe8a7e100201b1a3b9efad33fccc1c204334af2543282e13d3bbcfe",
    ],
  },
  "schemas-guide-v2": {
    current: "15f7fdb102d01ad5fa68bf2b706d5c2af26cffaff4822e0278620786b39d1bc7",
    superseded: [

    ],
  },
  "tricks-guide-v2": {
    current: "137dce417fdadb44e12aaf9c8eb1378bf9dad35491b7f0d5ab0eed92c5c6a52a",
    superseded: [

    ],
  },
  "views-guide-v2": {
    current: "f6be48fb86eed3b36edbb335f3ead34e97c58b6bb172cdfe1458b0a3ddfc8472",
    superseded: [

    ],
  },
} satisfies Record<string, TemplateStockEntry>;
