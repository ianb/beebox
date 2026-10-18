// # fenceForPrompt
//
// `fenceForPrompt` wraps untrusted content in a code fence long enough that no
// backtick run inside the content can close the fence early (the CommonMark
// dynamic-fence rule). It is the sole producer of `PromptSafeText`.
//
// Expected values use `JSON.stringify` so the exact backticks and newlines are
// literal and unambiguous (a raw fence in an expected block would break the
// doctest's own markdown parsing).

import { test } from "tap";
import "agent-doctest/tap";
import { fenceForPrompt } from "../../src/lib/prompt-fence.js";

// ## Plain content gets the minimum 3-backtick fence
//
// Content with no backticks is wrapped in the CommonMark minimum fence, with a
// trailing newline ensured before the closing fence.
void test("Content with no backticks is wrapped in the CommonMark minimum fence, with a...", async (t) => {
  // doctest:L21
  await t.checkText(JSON.stringify(fenceForPrompt("hello world")), "\"```\\nhello world\\n```\"");
});

// ## Content ending in a newline is not double-spaced
//
// An existing trailing newline is reused — the closing fence still lands on its
// own line, with no extra blank line.
void test("An existing trailing newline is reused — the closing fence still lands on its...", async (t) => {
  // doctest:L31
  await t.checkText(JSON.stringify(fenceForPrompt("line one\nline two\n")), "\"```\\nline one\\nline two\\n```\"");
});

// ## A triple-backtick run in the content forces a four-backtick fence
//
// Content containing its own ``` fenced block is wrapped one backtick longer, so
// the inner run cannot close the outer fence.
void test("Content containing its own  fenced block is wrapped one backtick longer, so t...", async (t) => {
  // doctest:L41
  await t.checkText(JSON.stringify(fenceForPrompt("before\n```\ninside\n```\nafter")), "\"````\\nbefore\\n```\\ninside\\n```\\nafter\\n````\"");
});

// ## A run longer than the default wrapper is still contained
//
// A run of five backticks forces a six-backtick fence — the wrapper always beats
// the longest run by one, with no cap.
void test("A run of five backticks forces a six-backtick fence — the wrapper always beat...", async (t) => {
  // doctest:L51
  const fenced = fenceForPrompt("x `````");
  await t.checkText(fenced.startsWith("``````\n"), "true");

  // doctest:L55
  await t.checkText(fenced.endsWith("\n``````"), "true");
});

// ## Empty content yields a valid empty block
//
// Empty content produces an open fence, a newline, and a close fence — no interior
// line.
void test("Empty content produces an open fence, a newline, and a close fence — no inter...", async (t) => {
  // doctest:L65
  await t.checkText(JSON.stringify(fenceForPrompt("")), "\"```\\n```\"");
});

// ## Tilde runs in content are ignored
//
// A backtick fence cannot be closed by a tilde line, so tilde-fenced content nests
// inside the minimum 3-backtick fence untouched.
void test("A backtick fence cannot be closed by a tilde line, so tilde-fenced content ne...", async (t) => {
  // doctest:L75
  await t.checkText(JSON.stringify(fenceForPrompt("~~~~\ntilde block\n~~~~")), "\"```\\n~~~~\\ntilde block\\n~~~~\\n```\"");
});

// ## A bare carriage-return ending still gets its own closing line
//
// Content ending in `\r` (no `\n`) is not treated as newline-terminated, so a
// newline is added before the closing fence.
void test("Content ending in \\r (no \\n) is not treated as newline-terminated, so a newli...", async (t) => {
  // doctest:L85
  await t.checkText(JSON.stringify(fenceForPrompt("partial\r")), "\"```\\npartial\\r\\n```\"");
});
