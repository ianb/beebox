// Typed characters reach the box browser with a real keyboard's key code.
//
// The dashboard sends a character's code point as its Windows virtual-key
// code, and below 48 those name editing keys: "." (46) is Delete. The bridge
// rewrites the code from the physical key; everything else passes unchanged.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { correctKeyCode, virtualKeyCode } from "../../../../../src/webapp/routes/browser/proxy/key-code.js";

function keyMessage(key: string, { code, windowsVirtualKeyCode }: { code: string; windowsVirtualKeyCode: number }): Buffer {
  return Buffer.from(JSON.stringify({ type: "input_keyboard", eventType: "keyDown", key, code, text: key, windowsVirtualKeyCode, modifiers: 0 }));
}

function sentKeyCode(data: Buffer | string | Buffer[] | ArrayBuffer): unknown {
  const parsed: unknown = JSON.parse(typeof data === "string" ? data : Buffer.from(Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data instanceof ArrayBuffer ? data : data)).toString("utf8"));
  return typeof parsed === "object" && parsed !== null && "windowsVirtualKeyCode" in parsed ? parsed.windowsVirtualKeyCode : null;
}

void test("physical keys map to the codes a real keyboard reports", (t) => {
  t.check(
    { a: virtualKeyCode("KeyA"), z: virtualKeyCode("KeyZ"), five: virtualKeyCode("Digit5"), numpad3: virtualKeyCode("Numpad3"), period: virtualKeyCode("Period"), quote: virtualKeyCode("Quote"), enter: virtualKeyCode("Enter") },
    { a: 65, z: 90, five: 53, numpad3: 99, period: 190, quote: 222, enter: 0 },
  );
  t.end();
});

void test("a typed period, hyphen and parenthesis no longer read as Delete, Insert and Down", (t) => {
  t.check(
    {
      period: sentKeyCode(correctKeyCode(keyMessage(".", { code: "Period", windowsVirtualKeyCode: 46 }), false)),
      hyphen: sentKeyCode(correctKeyCode(keyMessage("-", { code: "Minus", windowsVirtualKeyCode: 45 }), false)),
      paren: sentKeyCode(correctKeyCode(keyMessage("(", { code: "Digit9", windowsVirtualKeyCode: 40 }), false)),
      letter: sentKeyCode(correctKeyCode(keyMessage("x", { code: "KeyX", windowsVirtualKeyCode: 120 }), false)),
      unknownKey: sentKeyCode(correctKeyCode(keyMessage("é", { code: "", windowsVirtualKeyCode: 233 }), false)),
    },
    { period: 190, hyphen: 189, paren: 57, letter: 88, unknownKey: 0 },
  );
  t.end();
});

void test("named keys, mouse input, non-JSON and binary messages pass through unchanged", (t) => {
  const enter = Buffer.from(JSON.stringify({ type: "input_keyboard", eventType: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }));
  const mouse = Buffer.from(JSON.stringify({ type: "input_mouse", eventType: "mousePressed", x: 1, y: 2 }));
  const garbage = Buffer.from("not json");
  const binary = keyMessage(".", { code: "Period", windowsVirtualKeyCode: 46 });
  // The same object comes back, so the bridge forwards the original bytes.
  t.check(
    { enter: correctKeyCode(enter, false) === enter, mouse: correctKeyCode(mouse, false) === mouse, garbage: correctKeyCode(garbage, false) === garbage, binary: correctKeyCode(binary, true) === binary },
    { enter: true, mouse: true, garbage: true, binary: true },
  );
  t.end();
});
