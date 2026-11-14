// # What this person shows the others in a chat
//
// `composingAt` decides what a person shows as composing: dictating wins over typing;
// typing needs text in the composer and a keystroke within `TYPING_IDLE_MS`,
// so a word typed and left alone stops showing, and a send (empty text)
// stops it at once.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { composingAt, TYPING_IDLE_MS } from "../../src/lib/composing.js";

void test("typing shows until the composer goes idle or empty; dictating wins", (t) => {
  const typed = { lastTypedAt: 1_000, textEmpty: false, dictating: false };
  t.check(
    [
      composingAt(typed, 1_000 + TYPING_IDLE_MS - 1),
      composingAt(typed, 1_000 + TYPING_IDLE_MS),
      composingAt({ ...typed, textEmpty: true }, 1_001),
      composingAt({ lastTypedAt: null, textEmpty: false, dictating: false }, 1_001),
      composingAt({ ...typed, textEmpty: true, dictating: true }, 1_001),
    ],
    ["typing", null, null, null, "dictating"],
  );
  t.end();
});
