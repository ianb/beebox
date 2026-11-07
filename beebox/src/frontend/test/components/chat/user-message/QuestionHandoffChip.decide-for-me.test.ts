// # "Decide for me" shows in the chat as the question handed off
//
// The button starts a background chat whose first message is a
// `<question-handoff>`: an instruction to the agent naming the card's path and
// the skill. The person never wrote that instruction. The transcript shows what
// they did instead: "Decide for me" and the question's title, linking the card.
// The message is announced with no session id, and no open chat holds it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { serializeDeliveredUserMessage } from "@shared/delivered-user-message";
import { UserEntryContent } from "../../../../src/components/chat/user-message/user-entry-content.js";
import { holdsInjectedMessage } from "../../../../src/components/chat/everywhere/InteractiveChat/ws.js";
import type { SessionEntry } from "../../../../src/api.js";

globalThis.React = React;

const CARD = "_bookkeeping/questions/Talks_Guide.question.card";
const wire = serializeDeliveredUserMessage({ kind: "question-handoff", doc: CARD, title: "Which talks go in the guide?" });

async function render(text: string): Promise<string> {
  const entry: SessionEntry = { uuid: "u1", type: "user", timestamp: "2026-11-06T09:00:00Z", content: [{ type: "text", text }] };
  const element = React.createElement(UserEntryContent, { entry, debugView: false });
  const root = createRootRoute({ staticData: { title: null } });
  const route = createRoute({ getParentRoute: () => root, path: "/$boxSlug", staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ["/test1"] }) });
  await router.load();
  return renderToStaticMarkup(React.createElement(RouterProvider, { router }));
}

/** The visible words and the link, without markup. */
function shown(html: string) {
  return {
    text: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    href: /<a href="([^"]*)"/.exec(html)?.[1],
  };
}

// ## The stored message renders as the title, not the instruction
//
// The transcript stores the wrapper after the turn's `<chat-app/>` line.
void test("The stored message renders as the title, not the instruction", async (t) => {
  t.check(shown(await render(`<chat-app narration="off"/>\n${wire}`)), {
    text: "Decide for me Which talks go in the guide?",
    href: "/test1/views/_bookkeeping/questions/Talks_Guide.question.card",
  });
});

// ## A message the box announces with no session id stays out of open chats
//
// Before, a null id matched every open chat, so the instruction appeared in
// the chat beside the question card as the person's own message.
void test("A message the box announces with no session id stays out of open chats", async (t) => {
  t.check({
    newBackgroundChatInAnOpenChat: holdsInjectedMessage(null, "session-open"),
    newBackgroundChatInAnEmptyChat: holdsInjectedMessage(null, null),
    thisChat: holdsInjectedMessage("session-open", "session-open"),
    anotherChat: holdsInjectedMessage("session-other", "session-open"),
  }, {
    newBackgroundChatInAnOpenChat: false,
    newBackgroundChatInAnEmptyChat: false,
    thisChat: true,
    anotherChat: false,
  });
});
