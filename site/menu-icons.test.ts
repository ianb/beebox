import assert from "node:assert/strict";
import { test } from "node:test";
import { addMenuIcons } from "./menu-icons.js";

test("known off-site links get their mark; other links are untouched", () => {
  const html = addMenuIcons('<a href="https://github.com/ianb/beebox">Source</a> <a href="https://discord.gg/x">Chat</a> <a href="https://example.com/github.com">Other</a> <a href="/index.html">Home</a>');
  assert.equal(html.match(/class="menu-icon"/g)?.length, 2);
  assert.match(html, /<a href="https:\/\/github\.com\/ianb\/beebox"><svg class="menu-icon"[^>]*><path d="M12 \.297/);
  assert.match(html, /<a href="https:\/\/discord\.gg\/x"><svg class="menu-icon"[^>]*><path d="M20\.317/);
  assert.match(html, /<a href="https:\/\/example\.com\/github\.com">Other<\/a>/);
});
