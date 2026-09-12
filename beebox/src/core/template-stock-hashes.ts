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
    current: "1290649a5abe4684c99ebd86386e152cd2cb3af411b0fb33d86673736dea972c",
    superseded: [
      "15f7fdb102d01ad5fa68bf2b706d5c2af26cffaff4822e0278620786b39d1bc7",
      "ead7b46ef2e62d3e0d453e8b3b0d30b58f1b92d72ab380c9ae0969ed240e65d7",
      "f42242f4226592409bd2e95b076f9e88f0bf2270480df68e288a31ea1f6212df",
      "8cef3e54d557d88bc5916e92861159bea1d41e505a4ba6b660ae429358369f0f",
    ],
  },
  "tricks-guide-v2": {
    current: "26f9d95120144fe955ce38f444bbc1b41f7a28472b4f6c7aa2e1fdf62599f58f",
    superseded: [
      "137dce417fdadb44e12aaf9c8eb1378bf9dad35491b7f0d5ab0eed92c5c6a52a",
      "7c4e400f08d7ce0f4c524183b39c8e93a96d57ffa0b6794f4c04adce58f5b30f",
      "cb0f9f6f702e68a4033bc1192bd1366ae28038fbfed4726db8500da30e80e2c8",
      "661f67ec143797b2201db7c0386f1a684dd74dc5a219480f9793d748408554e9",
      "7302df58560d8a727a8c3d1feedca9e8d6b1bb6533a6a2d558eae4ce895244b0",
    ],
  },
  "views-guide-v2": {
    current: "2bfad7f343fa6818ab65f7d577aeba427cae1f78dcf6b96f449e5b18ff7a7e3b",
    superseded: [
      "f6be48fb86eed3b36edbb335f3ead34e97c58b6bb172cdfe1458b0a3ddfc8472",
      "e8f5e99502aa1da29e07f9e5c68bbe3c1ac3c6dba216fc27c5463f8f0272d772",
      "d53ddddd5f418fa7cd2bb9f043e77b2ec37314e9df7b0879979abe433739c61f",
      "f1237111213cdea6c45fbed5ecda10d7108b1221d234bf596e5fc68deee326bf",
      "d5a4f8b633f555f7898bed7632f02e6c9c75a76c35fe6fa4fb775c7039c26fc8",
    ],
  },
} satisfies Record<string, TemplateStockEntry>;
