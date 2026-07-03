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
 * is then recognized as unmodified stock and cleanly overwritten on `cb init`
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

export const TEMPLATE_STOCK_HASHES: Record<string, TemplateStockEntry> = {
  "schemas-guide": {
    current: "f42242f4226592409bd2e95b076f9e88f0bf2270480df68e288a31ea1f6212df",
    superseded: [
      "127bdcaa2598ad8664037bd01659e8f23d4fcd5af493788102b9387b090b5452",
    ],
  },
  "views-guide": {
    current: "f6be48fb86eed3b36edbb335f3ead34e97c58b6bb172cdfe1458b0a3ddfc8472",
    superseded: [
      "e32a89430eb0a2bf05ca833e4311f7857543c5a83f1862d03240911952abdeba",
      "a4fb7c549b4489596a74e51414450e70717402c416117ae292ce0ce85f9e822c",
      "194058211ef635603909c19041b8db17d1beb7620f6510510aa5ad9d78a33c1b",
    ],
  },
};
