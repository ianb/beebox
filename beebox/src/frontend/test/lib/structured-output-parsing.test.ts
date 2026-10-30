// # Structured-output parsing
//
// `src/frontend/src/lib/structured-output-parsing.ts` parses the two
// new agent output tags — `<ack>` (transient indications) and
// `<callout>` (durable, self-contained content) — and the related
// strip helper that pulls them (plus `<chat-app>`) out of the prose
// markdown stream before rendering.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  ACK_KINDS,
  getAckKind,
  parseAcks,
  parseCallouts,
  splitCalloutParts,
  stripStructuredOutputTags,
  isNoResponseOnly,
} from "../../src/lib/structured-output-parsing.js";

// Several assertions feed deliberately malformed tags to exercise the
// warn-and-skip paths. Silence console.warn so the warnings don't pollute
// test output.
console.warn = () => {};

// ## Ack kinds registry
//
// An unrecognized kind has no entry.
void test("An unrecognized kind has no entry.", async (t) => {
  t.check(getAckKind("nope"), null);
});

// ## parseAcks — valid kinds
//
// Self-closing form, no inner text.
void test("Self-closing form, no inner text.", async (t) => {
  t.check(parseAcks("<ack kind=\"appended\" ref=\"a.card\"/>"), [
    {
      kind: "appended",
      ref: "a.card",
    },
  ]);
});

// Paired form with inner text.
void test("Paired form with inner text.", async (t) => {
  t.check(parseAcks("<ack kind=\"edited\" ref=\"a.md\">Reworked the intro</ack>"), [
    {
      kind: "edited",
      ref: "a.md",
      text: "Reworked the intro",
    },
  ]);
});

// Empty text is dropped, ref is optional.
void test("Empty text is dropped, ref is optional.", async (t) => {
  t.check(parseAcks("<ack kind=\"created\"></ack>"), [
    {
      kind: "created",
    },
  ]);
});

// ## parseAcks — unknowns are dropped
//
// Unknown kinds are silently dropped (with a console warning the caller
// can ignore). Acks with no `kind` attribute are also dropped.
void test("Unknown kinds are silently dropped (with a console warning the caller can ign...", async (t) => {
  t.check(parseAcks("<ack kind=\"frob\"/>"), []);

  t.check(parseAcks("<ack ref=\"x.card\"/>"), []);
});

// Mixed valid and invalid in one response — valids survive.
void test("Mixed valid and invalid in one response — valids survive.", async (t) => {
  t.check(
    parseAcks(
      "prose <ack kind=\"created\" ref=\"a.card\"/> more <ack kind=\"frob\"/> end"
    ),
    [
    {
      kind: "created",
      ref: "a.card",
    },
  ],
  );
});

// ## Bare `<no-response/>` alias
//
// The agent sometimes writes the bare `<no-response/>` shorthand instead of the
// canonical `<ack kind="no-response"/>`. It's normalized everywhere — parsed as a
// no-response ack, stripped from prose, and recognized by `isNoResponseOnly` —
// so it never leaks into the render.
void test("The agent sometimes writes the bare <no-response/> shorthand instead of the c...", async (t) => {
  t.check(parseAcks("<no-response/>"), [
    {
      kind: "no-response",
    },
  ]);

  t.check(stripStructuredOutputTags("ok<no-response/>"), "ok");

  t.check(isNoResponseOnly("<no-response/>"), true);
});

// A callout is content: a turn with a callout and a no-response ack is not empty.
void test("A callout is content.", async (t) => {
  t.check(isNoResponseOnly('<callout context="/loans/drill.card">Due Friday.</callout><ack kind="no-response"/>'), false);
});

// The paired form (`<no-response></no-response>`) normalizes the same way.
void test("The paired form (<no-response></no-response>) normalizes the same way.", async (t) => {
  t.check(isNoResponseOnly("<no-response></no-response>"), true);
});

// ## Bare kind aliases for every ack kind
//
// The same slip happens with the other kinds: a journey walk saw a reply whose
// prose read a literal `<todo-added>` because the agent wrote the kind as the tag
// name. Every registered kind normalizes like `<no-response/>`: self-closing,
// paired (inner text becomes the ack's text), or a lone opening tag.
// Attributes such as `ref` carry over.
void test("The same slip happens with the other kinds:", async (t) => {
  t.check(parseAcks("Saved it.<todo-added>"), [
    {
      kind: "todo-added",
    },
  ]);

  t.check(stripStructuredOutputTags("Saved it.<todo-added>"), "Saved it.");

  t.check(parseAcks("<created ref=\"a.card\"/> and <edited ref=\"b.md\">the intro</edited>"), [
    {
      kind: "created",
      ref: "a.card",
    },
    {
      kind: "edited",
      ref: "b.md",
      text: "the intro",
    },
  ]);

  t.check(stripStructuredOutputTags("a<todo-completed/>b<appended>x</appended>c"), "abc");
});

// The alias pattern lists the kinds by hand. Every registered kind must
// normalize, so a kind added to `ACK_KINDS` without the pattern fails here.
void test("The alias pattern lists the kinds by hand.", async (t) => {
  t.check(
    ACK_KINDS.map((k) => parseAcks(`<${k.kind}/>`)),
    ACK_KINDS.map((k) => [{ kind: k.kind }]),
  );
});

// Only exact kind names are aliases. A longer tag that starts with a kind name
// is left alone.
void test("Only exact kind names are aliases.", async (t) => {
  t.check(parseAcks("<created-at>"), []);
});

// ## Aliases inside Markdown code stay literal
//
// A reply that explains the tags shows them as code. Normalizing there would
// replace the example with an ack: the prose would lose the example and gain a
// false indication. Inline code spans and fenced blocks are left as written.
void test("A reply that explains the tags shows them as code.", async (t) => {
  t.check(stripStructuredOutputTags("Write `<created>` here"), "Write `<created>` here");

  t.check(parseAcks("Write `<created>` here"), []);
});

// A fenced block is left alone as well. (The example uses a `~~~` fence so it
// can sit inside this file's own code fence; backtick fences match the same way.)
void test("A fenced block is left alone as well.", async (t) => {
  const fenced = "Example:\n~~~\n<todo-added>\n~~~\nDone.";
  t.check(stripStructuredOutputTags(fenced).split("\n"), [
    "Example:",
    "~~~",
    "<todo-added>",
    "~~~",
    "Done.",
  ]);

  t.check(parseAcks(fenced), []);

  t.check(parseAcks("Example:\n" + "`".repeat(3) + "\n<todo-added>\n" + "`".repeat(3)), []);
});

// A bare tag outside the code still normalizes in the same reply.
void test("A bare tag outside the code still normalizes in the same reply.", async (t) => {
  t.check(stripStructuredOutputTags("Use `<created>` for files.<todo-added>"), "Use `<created>` for files.");
});

// ## parseCallouts
//
// Single callout with a context label.
void test("Single callout with a context label.", async (t) => {
  t.check(
    parseCallouts(
      "<callout context=\"weather Sat\">Saturday: sunny, 72.</callout>"
    ),
    [
    {
      context: "weather Sat",
      body: "Saturday: sunny, 72.",
    },
  ],
  );
});

// Multiple callouts stack in document order.
void test("Multiple callouts stack in document order.", async (t) => {
  const r = parseCallouts(
    "<callout context=\"a\">first</callout> middle <callout context=\"b\">second</callout>"
  );
  t.check(r, [
    { context: "a", body: "first" },
    { context: "b", body: "second" },
  ]);
});

// Missing context → dropped. Empty body → dropped.
void test("Missing context → dropped.", async (t) => {
  t.check(parseCallouts("<callout>no context</callout>"), []);

  t.check(parseCallouts("<callout context=\"x\"></callout>"), []);
});

// ## splitCalloutParts keeps written order
//
// A reply renders its callouts where the agent wrote them. Before, every callout
// rendered after all of the reply's prose, so a sign-off written after the
// callout showed above it. Text parts keep their other tags for the prose
// renderer; a callout without a context is dropped, as `parseCallouts` drops it.
void test("A reply renders its callouts where the agent wrote them.", async (t) => {
  t.check(
    splitCalloutParts([
      "Here is the plan.",
      '<callout context="Tomorrow">Pick up the drill.</callout>',
      "Have a good evening.",
      "<callout>no context</callout>",
    ].join("\n")),
    [
    {
      type: "text",
      text: `Here is the plan.
`,
    },
    {
      type: "callout",
      callout: {
        context: "Tomorrow",
        body: "Pick up the drill.",
      },
    },
    {
      type: "text",
      text: `
Have a good evening.
`,
    },
  ],
  );
});

// ## stripStructuredOutputTags
//
// Removes `<ack>`, `<callout>`, and `<chat-app>` tags so the prose
// renderer doesn't show the raw XML. Self-closing and paired forms
// both strip.
void test("Removes <ack>, <callout>, and <chat-app> tags so the prose renderer doesn't s...", async (t) => {
  t.check(stripStructuredOutputTags("hello <ack kind=\"created\"/> world"), "hello  world");

  t.check(stripStructuredOutputTags("<callout context=\"x\">body</callout>after"), "after");

  t.check(stripStructuredOutputTags("before <chat-app narration=\"on\"/> after"), "before  after");
});

// The paired `<chat-app>` form with `<card-activity>` children (the
// companion-pane snapshot) strips whole, body included — otherwise the
// snapshot leaks into the displayed message.
void test("The paired <chat-app> form with <card-activity> children (the companion-pane...", async (t) => {
  t.check(stripStructuredOutputTags("<chat-app prose=\"on\" open-card=\"x\">\n<card-activity kind=\"explored\">king -> chief</card-activity>\n</chat-app>kept"), "kept");
});
