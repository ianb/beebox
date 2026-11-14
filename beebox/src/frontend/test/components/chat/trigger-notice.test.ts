// # Trigger notices are system rows
//
// A user entry that holds only `<trigger>` blocks is a trigger group and
// renders as a notice row, not a user bubble; one that mixes typed text with
// a trigger stays a user message with a chip. The card link reads as the
// card's name.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { cardTitleOf, entryTriggerNotices } from "../../../src/components/chat/trigger-notice.js";
import { groupMessages } from "../../../src/components/chat/message-parsing.js";
import type { SessionEntry } from "../../../src/api.js";

const WIRE = "<trigger label=\"Water check\" file=\"src/triggers/water.ts\" card=\"_content/figs/Molecule_Builder.figure.card\" fire=\"1\" entries=\"3\">\n<text>That's water.</text>\n<note>n</note>\n</trigger>";
const entry = (text: string, type?: SessionEntry["type"]): SessionEntry => ({ uuid: `u-${text.length.toString()}`, type: type ?? "user", timestamp: "2026-11-14T10:00:00.000Z", content: [{ type: "text", text }] });

void test("A trigger-only entry is a notice row; a mixed one keeps the bubble.", (t) => {
  t.check(entryTriggerNotices(entry(WIRE)), [{ kind: "trigger", label: "Water check", file: "src/triggers/water.ts", card: "_content/figs/Molecule_Builder.figure.card", fire: 1, entries: 3, done: false, text: "That's water.", note: "n" }]);
  t.check(entryTriggerNotices(entry(`<chat-app prose="on"/>\n${WIRE}\n`)), [{ kind: "trigger", label: "Water check", file: "src/triggers/water.ts", card: "_content/figs/Molecule_Builder.figure.card", fire: 1, entries: 3, done: false, text: "That's water.", note: "n" }]);
  t.check(entryTriggerNotices(entry(`hello\n${WIRE}`)), null);
  t.check(entryTriggerNotices(entry("hello")), null);
  t.check(entryTriggerNotices(entry(WIRE, "assistant")), null);
  t.check(groupMessages([entry("hi"), entry(WIRE), entry("there")]).map((g) => g.type), ["user", "trigger", "user"]);
  t.check(cardTitleOf("_content/figs/Molecule_Builder.figure.card"), "Molecule Builder");
  t.check(cardTitleOf("_content/notes/Plan.doc.card"), "Plan");
  t.end();
});
