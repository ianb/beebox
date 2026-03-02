/**
 * Tests for <chat-response> tag extraction from streamed agent output.
 *
 * The ChatThreadSession accumulates text from Claude's output and extracts
 * <chat-response>...</chat-response> blocks as they complete. Each extracted
 * block is emitted immediately so it can be delivered to the chat (Telegram,
 * web, etc.) without waiting for the full turn to finish.
 */

import { test } from "tap";
import { EventEmitter } from "node:events";

/**
 * Minimal reproduction of ChatThreadSession's response extraction logic.
 * Mirrors the private checkForResponses() method.
 */
class ResponseExtractor extends EventEmitter {
  turnText = "";

  addText(text: string): void {
    this.turnText += text;
    this.checkForResponses();
  }

  finalize(): void {
    this.checkForResponses();
  }

  private checkForResponses(): void {
    const regex = /<chat-response>([\S\s]*?)<\/chat-response>/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(this.turnText)) !== null) {
      const text = match[1]!.trim();
      if (text) {
        this.emit("chat-response", text);
      }
      lastIndex = regex.lastIndex;
    }

    if (lastIndex > 0) {
      this.turnText = this.turnText.slice(lastIndex);
    }
  }
}

test("extracts a single chat-response", async (t) => {
  const ext = new ResponseExtractor();
  const responses: string[] = [];
  ext.on("chat-response", (text: string) => responses.push(text));

  ext.addText("<chat-response>Hello!</chat-response>");

  t.equal(responses.length, 1);
  t.equal(responses[0], "Hello!");
});

test("extracts multiple chat-responses from one chunk", async (t) => {
  const ext = new ResponseExtractor();
  const responses: string[] = [];
  ext.on("chat-response", (text: string) => responses.push(text));

  ext.addText(
    "<chat-response>On it!</chat-response>some tool use stuff<chat-response>Done, updated the file.</chat-response>"
  );

  t.equal(responses.length, 2);
  t.equal(responses[0], "On it!");
  t.equal(responses[1], "Done, updated the file.");
});

test("extracts responses split across multiple chunks", async (t) => {
  const ext = new ResponseExtractor();
  const responses: string[] = [];
  ext.on("chat-response", (text: string) => responses.push(text));

  // First chunk: partial tag
  ext.addText("<chat-response>Looking into");
  t.equal(responses.length, 0, "no response yet - tag not closed");

  // Second chunk: closes first tag
  ext.addText(" that now</chat-response>");
  t.equal(responses.length, 1);
  t.equal(responses[0], "Looking into that now");

  // Third chunk: another response after some other output
  ext.addText("I'll check the config...<chat-response>All good, config is valid.</chat-response>");
  t.equal(responses.length, 2);
  t.equal(responses[1], "All good, config is valid.");
});

test("handles text before and after responses", async (t) => {
  const ext = new ResponseExtractor();
  const responses: string[] = [];
  ext.on("chat-response", (text: string) => responses.push(text));

  ext.addText("Let me think about this...\n<chat-response>Here's what I found</chat-response>\nNow doing more work...");

  t.equal(responses.length, 1);
  t.equal(responses[0], "Here's what I found");
  t.equal(ext.turnText, "\nNow doing more work...", "remaining text preserved");
});

test("skips empty responses", async (t) => {
  const ext = new ResponseExtractor();
  const responses: string[] = [];
  ext.on("chat-response", (text: string) => responses.push(text));

  ext.addText("<chat-response>  </chat-response><chat-response>Real response</chat-response>");

  t.equal(responses.length, 1);
  t.equal(responses[0], "Real response");
});

test("handles multiline responses", async (t) => {
  const ext = new ResponseExtractor();
  const responses: string[] = [];
  ext.on("chat-response", (text: string) => responses.push(text));

  ext.addText("<chat-response>Line one\nLine two\nLine three</chat-response>");

  t.equal(responses.length, 1);
  t.equal(responses[0], "Line one\nLine two\nLine three");
});

test("finalize catches trailing response", async (t) => {
  const ext = new ResponseExtractor();
  const responses: string[] = [];
  ext.on("chat-response", (text: string) => responses.push(text));

  ext.addText("thinking...<chat-response>Final answer</chat-resp");
  t.equal(responses.length, 0, "partial tag not yet extracted");

  ext.addText("onse>");
  t.equal(responses.length, 1);
  t.equal(responses[0], "Final answer");
});

test("simulates acknowledge-then-work-then-report pattern", async (t) => {
  const ext = new ResponseExtractor();
  const responses: string[] = [];
  const timestamps: number[] = [];
  ext.on("chat-response", (text: string) => {
    responses.push(text);
    timestamps.push(Date.now());
  });

  // Claude sends acknowledgment immediately
  ext.addText("<chat-response>Checking that for you</chat-response>");
  t.equal(responses.length, 1, "acknowledgment delivered immediately");

  // Claude does tool calls (no chat-response tags in this text)
  ext.addText("Let me read the file...\n[tool_use: Read file.txt]\n[tool_result: contents here]\n");
  t.equal(responses.length, 1, "no new response during tool use");

  // Claude sends result
  ext.addText("<chat-response>Found it — the config has 3 entries and looks correct.</chat-response>");
  t.equal(responses.length, 2, "result delivered after work");
  t.equal(responses[1], "Found it — the config has 3 entries and looks correct.");
});
