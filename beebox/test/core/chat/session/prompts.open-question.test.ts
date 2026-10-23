// # The chat prompt's open-question section
//
// The chat system prompt tells the agent what `open-question` on the snapshot
// means (the section is the attribute's documentation) and the order of operations when a message answers a pending card:
// directive and learning first, `bbx answer --via chat` last, an unrelated
// message leaves the card pending (docs/implemented-plans/front-door.md, Track A). The
// onboarding step of offering ideas after hearing rides on the root question's
// directive, not here, so the always-loaded prompt stays within its budget. This pins the rule's presence
// and its two anchors, the attribute and the command, so a prompt edit that
// drops either fails here rather than in a box.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { CHAT_SYSTEM_PROMPT } from "../../../../src/core/chat/session/prompts.js";

void test("The chat prompt explains open-question and the answer order", async (t) => {
  const section = CHAT_SYSTEM_PROMPT.slice(CHAT_SYSTEM_PROMPT.indexOf("## An open question in this chat"), CHAT_SYSTEM_PROMPT.indexOf("## Commits"));
  const sentence = (re: RegExp) => re.exec(section)?.[0] ?? null;
  t.check({
    command: sentence(/`bbx answer <path> --via chat "<their words>"`/),
    order: sentence(/answering is the last step/),
    noJob: sentence(/a chat answer writes no follow-up job/),
    narration: sentence(/Never answer a card from a `narration="on"` message/),
    unrelated: sentence(/If it is about something else, reply to it and leave the card pending/),
    answered: sentence(/If the card is already answered, ignore the attribute/),
    rootTask: sentence(/on the root question \(`what-to-keep-track-of`\): there a concrete task counts as the answer/),
    saySo: sentence(/When you answer, say so in one line, naming the question/),
  }, {
    command: '`bbx answer <path> --via chat "<their words>"`',
    order: "answering is the last step",
    noJob: "a chat answer writes no follow-up job",
    narration: 'Never answer a card from a `narration="on"` message',
    unrelated: "If it is about something else, reply to it and leave the card pending",
    answered: "If the card is already answered, ignore the attribute",
    rootTask: "on the root question (`what-to-keep-track-of`): there a concrete task counts as the answer",
    saySo: "When you answer, say so in one line, naming the question",
  });
});
