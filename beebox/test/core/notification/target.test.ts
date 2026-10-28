// # Notification targets
//
// A target says where tapping a notification lands. It is a string with a
// scheme, parsed by `parseTarget` into a discriminated union and rendered by
// `targetUrl` into a root-relative deep link for one box. It is never a raw URL.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseTarget, formatTarget, targetUrl } from "../../../src/core/notification/target.js";

function render(value: string) {
  const target = parseTarget(value);
  return `${formatTarget(target)} -> ${targetUrl(target, { boxSlug: "family", notificationId: "n7Qx" })}`;
}

// ## The six schemes
//
// Cards and questions open the card beside the chat (a question as its stub
// card, as the app-bar question counter opens it).
// `chat:<id>` opens that chat; `chat:new` opens an empty chat that shows the
// notification (by id) as a banner. `admin:<section>` opens the Admin card with
// the section in its view state; the card opens the section's tab and scrolls
// to it.
void test("Cards and questions open the card beside the chat.", async (t) => {
  await t.checkText(["chat:8f2c-41aa", "chat:new", "card:_content/pets/pepper-shots.todo.card", "question:_bookkeeping/questions/Color.question.card", "admin:google-services", "dashboard"].map(render).join("\n"), `chat:8f2c-41aa -> /family/chat?session=8f2c-41aa
chat:new -> /family/chat?new=1&notification=n7Qx
card:_content/pets/pepper-shots.todo.card -> /family/views/_content/pets/pepper-shots.todo.card
question:_bookkeeping/questions/Color.question.card -> /family/views/_bookkeeping/questions/Color.question.card
admin:google-services -> /family/views/_config/interface/admin.card?viewState=%7B%22section%22%3A%22google-services%22%7D
dashboard -> /family/`);
});

// A card path is a box ref, resolved from the box root, so a leading slash or a
// `./` segment normalizes away:
void test("A card path is a box ref, resolved from the box root, so a leading slash or a...", async (t) => {
  t.check(render("card:/_content/./notes/Plan.doc.card"), "card:_content/notes/Plan.doc.card -> /family/views/_content/notes/Plan.doc.card");
});

// ## Bad values name the valid schemes
//
// A path that escapes the box or lands outside its underscore areas fails
// closed, like every other ref. Each error lists the schemes.
void test("A path that escapes the box or lands outside its underscore areas fails close...", async (t) => {
  await t.checkThrows(
    async () => (parseTarget("https://example.com/"))
    ,
    "InvalidTargetError: Invalid notification target \"https://example.com/\": unknown scheme \"https\". Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard",
  );

  await t.checkThrows(async () => (parseTarget("/box/health")), "InvalidTargetError: Invalid notification target \"/box/health\": no scheme. Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard");

  await t.checkThrows(async () => (parseTarget("card:../elsewhere/secret.card")), "InvalidTargetError: Invalid notification target \"card:../elsewhere/secret.card\": the path must name a file inside the box's underscore areas. Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard");

  await t.checkThrows(async () => (parseTarget("question:")), "InvalidTargetError: Invalid notification target \"question:\": \"question:\" needs a value after the colon. Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard");

  await t.checkThrows(async () => (parseTarget("chat:a b")), "InvalidTargetError: Invalid notification target \"chat:a b\": a chat session id has no spaces or URL delimiters. Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard");

  await t.checkThrows(async () => (parseTarget(`card:_content/${"x".repeat(1000)}.card`)), "InvalidTargetError: Invalid notification target \"card:_content/xxxxxxxxxxxxxxxxxxxxxxxxxx…\": longer than 1000 characters. Valid targets: chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard");
});

// A target over 1,000 characters is refused, so a notification's log line
// stays one atomic append.
