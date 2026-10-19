// # Moved-card recovery at the file-view boundary
//
// Navigation uses only the typed tRPC recovery value. A display message that
// happens to mention a move is not a protocol.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { cardLoadRecovery, fileChangeAffectsPath } from "../../src/lib/moved-card-recovery.js";
import { resolveLoadState } from "../../src/lib/file-load-state.js";

void test("line 11", async (t) => {
  // doctest:L12
  t.check(
    cardLoadRecovery({
      message: "Card not found",
      data: { recovery: { kind: "moved", path: "_content/archive/New.doc.card" } },
    }),
    {
    kind: "moved",
    path: "_content/archive/New.doc.card",
  },
  );

  // doctest:L18
  t.check(cardLoadRecovery({ message: "moved to _content/Guess.doc.card" }), null);

  // doctest:L21
  t.check(cardLoadRecovery({ data: { recovery: { kind: "moved", path: "not-a-card.md" } } }), null);
});

// A failed live refetch can retain cached content and still carry recovery. The
// two decisions are intentionally independent.
void test("A failed live refetch can retain cached content and still carry recovery.", async (t) => {
  // doctest:L29
  const movedError = {
    message: "Card not found: _content/Old.doc.card",
    data: { recovery: { kind: "moved", path: "_content/New.doc.card" } },
  };
  const cached = resolveLoadState({
    data: "the old cached body",
    isLoading: false,
    isLoadingError: false,
    isRefetchError: true,
    error: movedError,
  });
  t.check({ cached: cached.value, recovery: cardLoadRecovery(movedError) }, {
    cached: "the old cached body",
    recovery: { kind: "moved", path: "_content/New.doc.card" },
  });
});

// An exact file event always refreshes the open file. An ancestor event matters
// only when it is a rename, which covers a whole directory moving without making
// ordinary directory writes refetch every descendant.
void test("An exact file event always refreshes the open file.", async (t) => {
  // doctest:L52
  t.check(
    fileChangeAffectsPath(
      { event: "change", path: "/_content/session/Note.doc.card" },
      "_content/session/Note.doc.card",
    ),
    true,
  );

  // doctest:L58
  t.check(
    fileChangeAffectsPath(
      { event: "rename", path: "_content/session" },
      "_content/session/Note.doc.card",
    ),
    true,
  );

  // doctest:L64
  t.check(
    fileChangeAffectsPath(
      { event: "change", path: "_content/session" },
      "_content/session/Note.doc.card",
    ),
    false,
  );

  // doctest:L70
  t.check(
    fileChangeAffectsPath(
      { event: "rename", path: "_content/sess" },
      "_content/session/Note.doc.card",
    ),
    false,
  );
});
