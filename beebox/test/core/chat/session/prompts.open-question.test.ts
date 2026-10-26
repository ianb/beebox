// # The chat prompt's open-question section
//
// The chat system prompt tells the agent that a question card as `open-card`
// is the question the person sees beside the chat, and the order of operations when a message answers it:
// directive and learning first, `bbx answer --via chat` last, an unrelated
// message leaves the card as it is (docs/plans/questions-beside-the-chat.md, Track C). The
// onboarding step of offering ideas after hearing rides on the root question's
// directive, not here, so the always-loaded prompt stays within its budget. This pins the rule's presence
// and its two anchors, the open card and the command, so a prompt edit that
// drops either fails here rather than in a box.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { chatSystemPrompt } from "../../../../src/core/chat/session/prompts.js";

void test("The chat prompt explains a question as the open card and the answer order", async (t) => {
  const prompt = chatSystemPrompt();
  const section = prompt.slice(prompt.indexOf("## An open question in this chat"), prompt.indexOf("## Commits"));
  const sentence = (re: RegExp) => re.exec(section)?.[0] ?? null;
  t.check({
    trigger: sentence(/When `open-card` is an unanswered `\.question\.card` \(shown beside the chat\), the message probably answers it/),
    command: sentence(/`bbx answer <path> --via chat "<their words>"`/),
    order: sentence(/answering is the last step/),
    noJob: sentence(/a chat answer writes no follow-up job/),
    narration: sentence(/Never answer a card from a `narration="on"` message/),
    unrelated: sentence(/If it is about something else, reply to it and leave the card as it is/),
    answered: sentence(/If the card is already answered, ignore it/),
    rootTask: sentence(/on the root question \(`what-to-keep-track-of`\): there a concrete task counts as the answer/),
    saySo: sentence(/When you answer, say so in one line, naming the question/),
  }, {
    trigger: "When `open-card` is an unanswered `.question.card` (shown beside the chat), the message probably answers it",
    command: '`bbx answer <path> --via chat "<their words>"`',
    order: "answering is the last step",
    noJob: "a chat answer writes no follow-up job",
    narration: 'Never answer a card from a `narration="on"` message',
    unrelated: "If it is about something else, reply to it and leave the card as it is",
    answered: "If the card is already answered, ignore it",
    rootTask: "on the root question (`what-to-keep-track-of`): there a concrete task counts as the answer",
    saySo: "When you answer, say so in one line, naming the question",
  });
});
