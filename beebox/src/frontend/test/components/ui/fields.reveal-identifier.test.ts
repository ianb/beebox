// A password field can be revealed with a button whose name stays constant and
// whose aria-pressed carries the state; an identifier field turns off the
// phone keyboard's text corrections.
// First, and bare: React DOM must load after the happy-dom window exists.
import { byId, mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { TextField } from "../../../src/components/ui/fields/field.js";

const noop = (): void => undefined;

void test("a revealable password field toggles between hidden and shown", async (t) => {
  const view = await mount(h(TextField, { id: "bbx-t-pw", label: "Password", type: "password", value: "secret", onChange: noop, revealable: true }));
  const input = view.container.querySelector("#bbx-t-pw");
  const button = byId(view.container, "bbx-t-pw-reveal");
  const before = { type: input?.getAttribute("type"), name: button.getAttribute("aria-label"), pressed: button.getAttribute("aria-pressed"), buttonType: button.getAttribute("type") };
  await view.act(() => {
    button.click();
  });
  const after = {
    type: view.container.querySelector("#bbx-t-pw")?.getAttribute("type"),
    name: button.getAttribute("aria-label"),
    pressed: button.getAttribute("aria-pressed"),
    buttonType: button.getAttribute("type"),
  };
  await view.unmount();
  t.check(before, { type: "password", name: "Show password", pressed: "false", buttonType: "button" });
  t.check(after, { type: "text", name: "Show password", pressed: "true", buttonType: "button" });
});

void test("a password field without revealable has no button", async (t) => {
  const view = await mount(h(TextField, { id: "bbx-t-pw2", label: "Password", type: "password", value: "", onChange: noop }));
  const found = view.container.querySelector("button");
  await view.unmount();
  t.check(found, null);
});

void test("an identifier field turns off spellcheck, autocorrect, and capitalization", async (t) => {
  const view = await mount(h(TextField, { id: "bbx-t-host", label: "Hostname", value: "", onChange: noop, identifier: true }));
  const input = view.container.querySelector("input");
  const attrs = { spellcheck: input?.getAttribute("spellcheck"), autocapitalize: input?.getAttribute("autocapitalize"), autocorrect: input?.getAttribute("autocorrect") };
  await view.unmount();
  t.check(attrs, { spellcheck: "false", autocapitalize: "none", autocorrect: "off" });
});
