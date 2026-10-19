// # Pattern Matching
//
// `KeywordPattern` compiles pattern strings into matchers for detecting keywords in speech input. Patterns support alternatives, optional words, and multi-word groups.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { KeywordPattern, TESTING_EXPORTS } from "../../../src/lib/patmatch/keyword-pattern.js";

const { normalizeWord } = TESTING_EXPORTS;

// ## Word normalization
//
// Words are lowercased with diacritics and punctuation stripped:
void test("Words are lowercased with diacritics and punctuation stripped:", async (t) => {
  // doctest:L15
  t.check(normalizeWord("Hello"), "hello");

  // doctest:L18
  t.check(normalizeWord("café"), "cafe");

  // doctest:L21
  t.check(normalizeWord("it's"), "its");
});

// ## Simple word matching
//
// A pattern of literal words matches those words in order:
void test("A pattern of literal words matches those words in order:", async (t) => {
  // doctest:L30
  const p = KeywordPattern.compile("hello world");
  t.check(p.match("hello world")?.capturedTextTrimmed, "hello world");

  // doctest:L34
  t.check(p.match("goodbye world"), undefined);
});

// ## Plural tolerance
//
// Patterns match common English plural forms automatically — no need to write
// `message(s)?`:
void test("Patterns match common English plural forms automatically — no need to write m...", async (t) => {
  // doctest:L44
  const p = KeywordPattern.compile("send message");
  t.check(p.match("send messages")?.capturedTextTrimmed, "send messages");
});

// `+es` and `y → ies` plurals are also handled, in either direction:
void test("+es and y → ies plurals are also handled, in either direction:", async (t) => {
  // doctest:L52
  const p = KeywordPattern.compile("close (the)? box");
  t.check(p.match("close the boxes")?.capturedTextTrimmed, "close the boxes");

  // doctest:L58
  const q = KeywordPattern.compile("parties");
  t.check(q.match("the party started")?.capturedTextTrimmed, "party");
});

// ## Alternatives
//
// `(a | b)` matches either word:
void test("(a | b) matches either word:", async (t) => {
  // doctest:L68
  const p = KeywordPattern.compile("(send | deliver) message");
  t.check(p.match("send message")?.capturedTextTrimmed, "send message");

  // doctest:L72
  t.check(p.match("deliver message")?.capturedTextTrimmed, "deliver message");

  // doctest:L75
  t.check(p.match("post message"), undefined);
});

// ## Optional words
//
// `word?` or `(a | b)?` makes a word optional:
void test("word? or (a | b)? makes a word optional:", async (t) => {
  // doctest:L84
  const p = KeywordPattern.compile("send (the)? message");
  t.check(p.match("send the message")?.capturedTextTrimmed, "send the message");

  // doctest:L88
  t.check(p.match("send message")?.capturedTextTrimmed, "send message");
});

// ## Multi-word groups
//
// Parenthesized groups can contain multi-word alternatives:
void test("Parenthesized groups can contain multi-word alternatives:", async (t) => {
  // doctest:L97
  const p = KeywordPattern.compile("(good morning | hello)");
  t.check(p.match("good morning")?.capturedTextTrimmed, "good morning");

  // doctest:L101
  t.check(p.match("hello")?.capturedTextTrimmed, "hello");
});

// ## Multiple pattern lines
//
// Patterns with multiple lines act as OR between whole phrases:
void test("Patterns with multiple lines act as OR between whole phrases:", async (t) => {
  // doctest:L110
  const p = KeywordPattern.compile(`
  send message
  message done
`);
  t.check(p.match("send message")?.capturedTextTrimmed, "send message");

  // doctest:L117
  t.check(p.match("message done")?.capturedTextTrimmed, "message done");
});

// ## Match position and replacement
//
// Matches can appear anywhere in the input. The match tracks leading and remaining words:
void test("Matches can appear anywhere in the input.", async (t) => {
  // doctest:L126
  const p = KeywordPattern.compile("hello");
  const m = p.match("well hello there");
  t.check(m?.capturedTextTrimmed, "hello");

  // doctest:L133
  t.check(m?.replace("[GREETING]"), "well [GREETING]there");
});

// ## Punctuation handling
//
// Punctuation doesn't prevent matching:
void test("Punctuation doesn't prevent matching:", async (t) => {
  // doctest:L142
  const p = KeywordPattern.compile("hello world");
  t.check(p.match("hello, world!")?.capturedTextTrimmed, "hello, world!");
});

// ## Empty input
void test("Empty input", async (t) => {
  // doctest:L150
  const p = KeywordPattern.compile("hello");
  t.check(p.match(""), undefined);

  // doctest:L154
  t.check(p.match("   "), undefined);
});
