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
  "agent-feedback-guide": {
    current: "7b70d5b4c06c7820224a5da90ec6d2f577b0761381f5828481575f980f939ef9",
    superseded: [
      "685ab3899807ab4d52705e67080832906d2ac4ce5da3c4ae1171b4c6b69fdc5f",
      "84e32a13b19db444378f23296b4ec5f4e96f5edcd51f233a2a18b9047cd95b2d",
    ],
  },
  "briefing-seed": {
    current: "41b51d86bb5d6c4fd789abaa3c124d3afd945c52dc56e262a109ab18d57b72d6",
    superseded: [
      "4e5fc48a9fe8a7e100201b1a3b9efad33fccc1c204334af2543282e13d3bbcfe",
      "ef850476650452469d989cb94c85d1d8b1fa10eee32d3568930cbb12d15489cc",
      "0bd4ee1cba5fbdab3a9ecc2ebedc1fc7ce99577cc77928a5e094d8164de73055",
    ],
  },
  "schemas-guide-v2": {
    current: "d597ae37034efae913366d3afbf5561785dbc633445df8832ff8cb9e588c855f",
    superseded: [
      "0dcb1c9c7f4ea860bc4d2312db9fd32ec436d09e90459879d9f0b8f2077cbe31",
      "5b984a1082f457a5b05e4f959e8c822221902acaf7f5182b593a89696df1b09c",
      "15f7fdb102d01ad5fa68bf2b706d5c2af26cffaff4822e0278620786b39d1bc7",
      "ead7b46ef2e62d3e0d453e8b3b0d30b58f1b92d72ab380c9ae0969ed240e65d7",
      "f42242f4226592409bd2e95b076f9e88f0bf2270480df68e288a31ea1f6212df",
      "8cef3e54d557d88bc5916e92861159bea1d41e505a4ba6b660ae429358369f0f",
      "1290649a5abe4684c99ebd86386e152cd2cb3af411b0fb33d86673736dea972c",
      "238a9263cfa2194a6c06a44e8155e0b7a65042e883fb97880cb10592b5c3b4ff",
      "d0021bd9506ab4255818d9246019471a5ef0ca7627a8f6a1544305bf8033ae37",
    ],
  },
  "tricks-guide-v2": {
    current: "1f9b7ba407d06512cf07a956ca3f29371dc734beb81a8ab110b8707dceead0a2",
    superseded: [
      "08882d2ce756848de7805fc148a4415e58e929c4e46993126e325becc5e0325c",
      "c25960f7eccbf7bb99ecdc80598f4dd7faa00b042d945a1e3a7a10047b2177da",
      "137dce417fdadb44e12aaf9c8eb1378bf9dad35491b7f0d5ab0eed92c5c6a52a",
      "7c4e400f08d7ce0f4c524183b39c8e93a96d57ffa0b6794f4c04adce58f5b30f",
      "cb0f9f6f702e68a4033bc1192bd1366ae28038fbfed4726db8500da30e80e2c8",
      "661f67ec143797b2201db7c0386f1a684dd74dc5a219480f9793d748408554e9",
      "7302df58560d8a727a8c3d1feedca9e8d6b1bb6533a6a2d558eae4ce895244b0",
      "26f9d95120144fe955ce38f444bbc1b41f7a28472b4f6c7aa2e1fdf62599f58f",
      "6028707b9584cd03ed9c6290d9d0dcfca4cc84de292bec100963712492a6926d",
    ],
  },
  "views-guide-v2": {
    current: "0a5c2061f3d50523062dfd0cffd734fa83704ebffcbb4dbd717a9ce195c5bc38",
    superseded: [
      "f6be48fb86eed3b36edbb335f3ead34e97c58b6bb172cdfe1458b0a3ddfc8472",
      "e8f5e99502aa1da29e07f9e5c68bbe3c1ac3c6dba216fc27c5463f8f0272d772",
      "d53ddddd5f418fa7cd2bb9f043e77b2ec37314e9df7b0879979abe433739c61f",
      "f1237111213cdea6c45fbed5ecda10d7108b1221d234bf596e5fc68deee326bf",
      "d5a4f8b633f555f7898bed7632f02e6c9c75a76c35fe6fa4fb775c7039c26fc8",
      "2bfad7f343fa6818ab65f7d577aeba427cae1f78dcf6b96f449e5b18ff7a7e3b",
      "3590c68aa6ba2ade37d00699a0bec3af0b54d50cd414b7e90da9761042fe7141",
    ],
  },
} satisfies Record<string, TemplateStockEntry>;
