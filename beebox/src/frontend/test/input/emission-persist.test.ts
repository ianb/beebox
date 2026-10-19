// # Emission persistence — singleton key, size gating, legacy adoption
//
// Whole-emission persistence under `bbx-input-emission:<box>` — the
// composition survives reloads and session switches (the singleton-draft
// decision). See docs/plans/input-extraction.md chunk 4.

import { test } from "tap";
import "agent-doctest/tap";
import {
  emissionKey,
  serializePersistedEmission,
  parsePersistedEmission,
  loadPersistedEmission,
  savePersistedEmission,
  commitPersistedEmission,
  isEmptyEmissionDraft,
  adoptLegacyComposerDrafts,
  restoredImageOriginal,
  RESTORED_ORIGINAL_LOST,
  RESTORED_ORIGINAL_SWEPT,
  partitionFiles,
  PERSIST_BYTE_BUDGET,
  type KeyValueStorage,
} from "../../src/input/emission-persist.js";
import type { EmissionDraft } from "../../src/input/emission-store.js";

type PersistableDraft = Pick<EmissionDraft, "text" | "images" | "files" | "selections" | "uploadBatch">;

function fakeStorage(): KeyValueStorage & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    dump: () => Object.fromEntries(m),
  };
}

const draft: PersistableDraft = {
  text: "half a thought [file1]",
  images: [],
  files: [{ id: 1, originalName: "report.pdf", size: 100, mimetype: "application/pdf", state: { status: "uploaded", path: "_tmp/2026-07-04_report.pdf" } }],
  selections: [],
  uploadBatch: null,
};

// ## Round-trip under the singleton key
void test("Round-trip under the singleton key", async (t) => {
  // doctest:L57
  const s = fakeStorage();
  savePersistedEmission(s, { boxSlug: "test1", scope: "", draft, updatedAt: 1000 });
  const loaded = loadPersistedEmission(s, { boxSlug: "test1", scope: "" });
  t.check(loaded, {
    version: 1,
    text: "half a thought [file1]",
    images: [],
    files: [
      {
        id: 1,
        originalName: "report.pdf",
        size: 100,
        mimetype: "application/pdf",
        state: {
          status: "uploaded",
          path: "_tmp/2026-07-04_report.pdf",
        },
      },
    ],
    selections: [],
    updatedAt: 1000,
  });

  // doctest:L66
  t.check(emissionKey({ boxSlug: undefined, scope: "" }), "bbx-input-emission:default");
});

// ## One slot per box INSTANCE, not per box slug
//
// The dev router serves every checkout from one origin at
// `/<main|worktree>/<box>/…`, so two worktrees can each have a `test1` and the
// slug alone does not tell them apart. They shared a draft — including its `tmp/…`
// attachment paths, which the receiving clone then reported as expired
// (`issues/bugs/2026-09-08-draft-storage-crosses-development-worktrees.md`).
//
// Production's scope is empty, and there the key is exactly what it always was, so
// a real unsent draft is not orphaned by a dev-only fix.
void test("The dev router serves every checkout from one origin at /<main|worktree>/<box...", async (t) => {
  // doctest:L82
  t.check(
    [
      emissionKey({ boxSlug: "test1", scope: "main/test1" }),
      emissionKey({ boxSlug: "test1", scope: "worktree-drafts/test1" }),
      emissionKey({ boxSlug: "test1", scope: "" }),
    ],
    [
    "bbx-input-emission:main/test1",
    "bbx-input-emission:worktree-drafts/test1",
    "bbx-input-emission:test1",
  ],
  );

  // Two checkouts writing at once keep their own text:

  // doctest:L93
  const shared = fakeStorage();
  savePersistedEmission(shared, { boxSlug: "test1", scope: "main/test1", draft: { ...draft, text: "from main" }, updatedAt: 1000 });
  savePersistedEmission(shared, { boxSlug: "test1", scope: "worktree-drafts/test1", draft: { ...draft, text: "from the worktree" }, updatedAt: 1001 });
  t.check(
    [
      loadPersistedEmission(shared, { boxSlug: "test1", scope: "main/test1" }),
      loadPersistedEmission(shared, { boxSlug: "test1", scope: "worktree-drafts/test1" }),
    ], [
    {
      version: 1,
      text: "from main",
      images: [],
      files: [
        {
          id: 1,
          originalName: "report.pdf",
          size: 100,
          mimetype: "application/pdf",
          state: {
            status: "uploaded",
            path: "_tmp/2026-07-04_report.pdf",
          },
        },
      ],
      selections: [],
      updatedAt: 1000,
    },
    {
      version: 1,
      text: "from the worktree",
      images: [],
      files: [
        {
          id: 1,
          originalName: "report.pdf",
          size: 100,
          mimetype: "application/pdf",
          state: {
            status: "uploaded",
            path: "_tmp/2026-07-04_report.pdf",
          },
        },
      ],
      selections: [],
      updatedAt: 1001,
    },
  ]);

  // A legacy per-session draft carries the slug alone, so in a dev checkout it
  // cannot be attributed to one. Adoption there takes nothing — and, just as
  // importantly, deletes nothing, since deleting is the outcome that cannot be
  // undone.

  // doctest:L109
  const legacy = fakeStorage();
  legacy.setItem("bbx-composer-draft:test1:sess-a", JSON.stringify({ text: "whose is this?", updatedAt: 5 }));
  const skipped = adoptLegacyComposerDrafts(legacy, { boxSlug: "test1", scope: "worktree-drafts/test1" });
  t.check([skipped, Object.keys(legacy.dump())], [
    {
      adoptedText: null,
      discarded: 0,
    },
    [
      "bbx-composer-draft:test1:sess-a",
    ],
  ]);
});

// ## A send empties the composer, and the key goes with it
//
// `commitPersistedEmission` is what the persistence hook runs on every store
// change. An empty draft — what every send site leaves behind once text,
// attachments, and selections are cleared — REMOVES the key rather than
// rewriting it empty, and the hook runs this synchronously instead of on the
// 400ms debounce. That is the fix for
// issues/bugs/2026-07-23-voice-send-lingers-as-unsent-recovery-draft.md: a
// debounced clear lost its race with an in-app navigation, so the pre-send
// draft survived and was offered back as "unsent".
void test("commitPersistedEmission is what the persistence hook runs on every store change.", async (t) => {
  // doctest:L128
  const s = fakeStorage();
  const empty: PersistableDraft = { text: "", images: [], files: [], selections: [], uploadBatch: null };

  // doctest:L131
  // Dictating persists a draft…
  commitPersistedEmission(s, { boxSlug: "test1", scope: "", draft: { ...draft, text: "send this please" }, updatedAt: 1000 });
  t.check(Object.keys(s.dump()), ["bbx-input-emission:test1"]);

  // doctest:L136
  // …and the send that empties the store takes the key with it. No window.
  commitPersistedEmission(s, { boxSlug: "test1", scope: "", draft: empty, updatedAt: 2000 });
  t.check({ keys: Object.keys(s.dump()), recoveryOffer: loadPersistedEmission(s, { boxSlug: "test1", scope: "" }) }, { keys: [], recoveryOffer: null });

  // doctest:L141
  t.check(
    // Emptiness is all four slices, not just the text.
    [isEmptyEmissionDraft(empty), isEmptyEmissionDraft({ ...empty, text: "x" }), isEmptyEmissionDraft(draft)],
    [true, false, false],
  );

  // doctest:L145
  // A non-empty draft still saves normally (that's the debounced typing path).
  commitPersistedEmission(s, { boxSlug: "test1", scope: "", draft, updatedAt: 3000 });
  t.check(loadPersistedEmission(s, { boxSlug: "test1", scope: "" }), {
    version: 1,
    text: "half a thought [file1]",
    images: [],
    files: [
      {
        id: 1,
        originalName: "report.pdf",
        size: 100,
        mimetype: "application/pdf",
        state: {
          status: "uploaded",
          path: "_tmp/2026-07-04_report.pdf",
        },
      },
    ],
    selections: [],
    updatedAt: 3000,
  });
});

// ## Oversized images are dropped from persistence, not from memory
void test("Oversized images are dropped from persistence, not from memory", async (t) => {
  // doctest:L154
  const big: PersistableDraft = { ...draft, images: [{ id: 1, mimeType: "image/png", dataBase64: "x".repeat(PERSIST_BYTE_BUDGET), objectUrl: "blob:x", byteLength: PERSIST_BYTE_BUDGET, original: { status: "uploading", progress: 0 } }] };
  const { payload, imagesDropped } = serializePersistedEmission(big, { updatedAt: 1 });
  t.check(imagesDropped, true);

  // doctest:L159
  const restored = parsePersistedEmission(payload);
  t.check(restored, {
    version: 1,
    text: "half a thought [file1]",
    images: [],
    files: [
      {
        id: 1,
        originalName: "report.pdf",
        size: 100,
        mimetype: "application/pdf",
        state: {
          status: "uploaded",
          path: "_tmp/2026-07-04_report.pdf",
        },
      },
    ],
    selections: [],
    updatedAt: 1,
  });
});

// ## Corrupt or absent payloads read as empty, never throw
void test("Corrupt or absent payloads read as empty, never throw", async (t) => {
  // doctest:L167
  t.check(parsePersistedEmission("not json {{{"), null);

  // doctest:L170
  t.check(parsePersistedEmission(JSON.stringify({ version: 99, text: "future" })), null);

  // doctest:L173
  t.check(parsePersistedEmission(null), null);
});

// ## Legacy adoption: most-recent wins, all old keys removed
//
// The named behavior change: other sessions' stale drafts are discarded,
// not merged.
void test("The named behavior change:", async (t) => {
  // doctest:L183
  const s = fakeStorage();
  s.setItem("bbx-composer-draft:test1:sess-a", JSON.stringify({ text: "older draft", updatedAt: 100 }));
  s.setItem("bbx-composer-draft:test1:sess-b", JSON.stringify({ text: "newest draft", updatedAt: 300 }));
  s.setItem("bbx-composer-draft:test1:sess-c", JSON.stringify({ text: "   ", updatedAt: 900 }));
  s.setItem("bbx-composer-draft:otherbox:sess-z", JSON.stringify({ text: "not ours", updatedAt: 999 }));
  const result = adoptLegacyComposerDrafts(s, { boxSlug: "test1", scope: "" });
  t.check(result, { adoptedText: "newest draft", discarded: 1 });

  // doctest:L195
  t.check(
    // This box's legacy keys are gone; the other box's are untouched.
    Object.keys(s.dump()).toSorted(),
    ["bbx-composer-draft:otherbox:sess-z"],
  );
});

// ## An unfinished upload is persisted, so restore can strip its token
//
// A file's `[file#N]` token enters the composer text the moment it is picked,
// before its bytes move. If a save dropped the still-uploading entry, the token
// would survive in the saved text with nothing to explain it — no chip, no
// expired note, and an id `reserveIds` never covers, so the next attachment could
// mint that id and adopt the orphan token. Persisting it keeps the two halves
// together; `partitionFiles` then finds it pathless and classes it dead, which is
// what strips the token on the way back in.
void test("A file's [file#N] token enters the composer text the moment it is picked, bef...", async (t) => {
  // doctest:L211
  const uploading = { id: 2, originalName: "big.pdf", size: 9, mimetype: "application/pdf", state: { status: "uploading", progress: 0.4 } } as const;
  const midUpload: PersistableDraft = { ...draft, text: "half a thought [file#1] [file#2]", files: [...draft.files, uploading] };
  const s2 = fakeStorage();
  savePersistedEmission(s2, { boxSlug: "test1", scope: "", draft: midUpload, updatedAt: 2000 });
  t.check(loadPersistedEmission(s2, { boxSlug: "test1", scope: "" }), {
    version: 1,
    text: "half a thought [file#1] [file#2]",
    images: [],
    files: [
      {
        id: 1,
        originalName: "report.pdf",
        size: 100,
        mimetype: "application/pdf",
        state: {
          status: "uploaded",
          path: "_tmp/2026-07-04_report.pdf",
        },
      },
      {
        id: 2,
        originalName: "big.pdf",
        size: 9,
        mimetype: "application/pdf",
        state: {
          status: "uploading",
          progress: 0.4,
        },
      },
    ],
    selections: [],
    updatedAt: 2000,
  });

  // doctest:L220
  const { live, dead } = partitionFiles(
    loadPersistedEmission(s2, { boxSlug: "test1", scope: "" })?.files ?? [],
    new Set(["_tmp/2026-07-04_report.pdf"]),
  );
  t.check({ live, dead }, {
    live: [
      {
        id: 1,
        originalName: "report.pdf",
        size: 100,
        mimetype: "application/pdf",
        state: {
          status: "uploaded",
          path: "_tmp/2026-07-04_report.pdf",
        },
      },
    ],
    dead: [
      {
        id: 2,
        originalName: "big.pdf",
        size: 9,
        mimetype: "application/pdf",
        state: {
          status: "uploading",
          progress: 0.4,
        },
      },
    ],
  });
});

// ## Restored files partition into live and dead (_tmp/ sweeps)
void test("Restored files partition into live and dead (_tmp/ sweeps)", async (t) => {
  // doctest:L231
  const uploaded = (id: number, path: string) =>
    ({ id, originalName: "f", size: 1, mimetype: "x", state: { status: "uploaded", path } }) as const;
  const files = [uploaded(1, "_tmp/alive.pdf"), uploaded(2, "_tmp/swept.pdf")];
  const { live, dead } = partitionFiles(files, new Set(["_tmp/alive.pdf"]));
  t.check({ live, dead }, {
    live: [
      {
        id: 1,
        originalName: "f",
        size: 1,
        mimetype: "x",
        state: {
          status: "uploaded",
          path: "_tmp/alive.pdf",
        },
      },
    ],
    dead: [
      {
        id: 2,
        originalName: "f",
        size: 1,
        mimetype: "x",
        state: {
          status: "uploaded",
          path: "_tmp/swept.pdf",
        },
      },
    ],
  });
});

// ## An image's original comes back landed, or failed — never resumable
//
// The `File` behind an upload dies with the page, so a persisted `uploading` or
// `failed` original — and a draft from before originals were kept, which has no
// state at all — restores as `failed`, silently: the message just lists no file
// for that image. A landed path survives when the restore-time existence check
// still finds it, and is `failed` with its own message when the sweep took it,
// so a swept path is never listed as a usable file.
void test("The File behind an upload dies with the page, so a persisted uploading or fai...", async (t) => {
  // doctest:L249
  const present = new Set(["_tmp/a.png"]);
  t.check(restoredImageOriginal({ status: "uploaded", path: "_tmp/a.png" }, { existingPaths: present }), {
    status: "uploaded",
    path: "_tmp/a.png",
  });

  // doctest:L253
  t.check(restoredImageOriginal({ status: "uploaded", path: "_tmp/swept.png" }, { existingPaths: present }), { status: "failed", message: RESTORED_ORIGINAL_SWEPT });

  // doctest:L256
  t.check(
    // A same-tab restore (a rejected send handed back) skips the check.
    restoredImageOriginal({ status: "uploaded", path: "_tmp/just-now.png" }, { existingPaths: null }),
    { status: "uploaded", path: "_tmp/just-now.png" },
  );

  // doctest:L260
  t.check(
    [
      restoredImageOriginal({ status: "failed", message: "413" }, { existingPaths: present }),
      restoredImageOriginal({ status: "uploading", progress: 0.7 }, { existingPaths: present }),
      restoredImageOriginal(undefined, { existingPaths: present }),
    ], [
    {
      status: "failed",
      message: RESTORED_ORIGINAL_LOST,
    },
    {
      status: "failed",
      message: RESTORED_ORIGINAL_LOST,
    },
    {
      status: "failed",
      message: RESTORED_ORIGINAL_LOST,
    },
  ]);
});

// The state itself rides through persistence with the image, so a landed path
// is still there after a reload.
void test("The state itself rides through persistence with the image, so a landed path i...", async (t) => {
  // doctest:L272
  const withOriginal: PersistableDraft = { ...draft, images: [{ id: 1, mimeType: "image/png", dataBase64: "aGk=", objectUrl: "blob:1", byteLength: 3, original: { status: "uploaded", path: "_tmp/a.png" } }] };
  const { payload } = serializePersistedEmission(withOriginal, { updatedAt: 1 });
  t.check(parsePersistedEmission(payload), {
    version: 1,
    text: "half a thought [file1]",
    images: [
      {
        id: 1,
        mimeType: "image/png",
        dataBase64: "aGk=",
        objectUrl: "blob:1",
        byteLength: 3,
        original: {
          status: "uploaded",
          path: "_tmp/a.png",
        },
      },
    ],
    files: [
      {
        id: 1,
        originalName: "report.pdf",
        size: 100,
        mimetype: "application/pdf",
        state: {
          status: "uploaded",
          path: "_tmp/2026-07-04_report.pdf",
        },
      },
    ],
    selections: [],
    updatedAt: 1,
  });
});

// The draft's upload batch persists with it, so attachments added after a
// reload join the same `_tmp/chat/<batch>/` directory; a draft saved before
// batches existed simply has none.
void test("The draft's upload batch persists with it, so attachments added after a reloa...", async (t) => {
  // doctest:L283
  const batched: PersistableDraft = { ...draft, uploadBatch: "m1abcd-x9y8z7w6" };
  t.check(parsePersistedEmission(serializePersistedEmission(batched, { updatedAt: 1 }).payload), {
    version: 1,
    text: "half a thought [file1]",
    uploadBatch: "m1abcd-x9y8z7w6",
    images: [],
    files: [
      {
        id: 1,
        originalName: "report.pdf",
        size: 100,
        mimetype: "application/pdf",
        state: {
          status: "uploaded",
          path: "_tmp/2026-07-04_report.pdf",
        },
      },
    ],
    selections: [],
    updatedAt: 1,
  });

  // doctest:L287
  t.check(parsePersistedEmission(serializePersistedEmission({ ...draft, uploadBatch: null }, { updatedAt: 1 }).payload), {
    version: 1,
    text: "half a thought [file1]",
    images: [],
    files: [
      {
        id: 1,
        originalName: "report.pdf",
        size: 100,
        mimetype: "application/pdf",
        state: {
          status: "uploaded",
          path: "_tmp/2026-07-04_report.pdf",
        },
      },
    ],
    selections: [],
    updatedAt: 1,
  });
});
