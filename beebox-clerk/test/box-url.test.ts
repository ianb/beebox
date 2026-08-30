import { test } from "tap";
import { boxChatUrl, boxPageUrl } from "../src/domain/box-url.js";

test("boxPageUrl appends a page path under the box's own prefix", async (t) => {
  t.equal(boxPageUrl("http://localhost:3210/main/test1", "browse/inbox"), "http://localhost:3210/main/test1/browse/inbox");
});

test("boxPageUrl tolerates trailing/leading slashes", async (t) => {
  t.equal(boxPageUrl("https://beebox.example.org/personal/", "/chat"), "https://beebox.example.org/personal/chat");
});

test("boxChatUrl names no session, so the box resolves the most-active one", async (t) => {
  t.equal(boxChatUrl("https://beebox.example.org/personal"), "https://beebox.example.org/personal/chat");
});
