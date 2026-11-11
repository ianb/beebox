// A field's hint or error is linked to its control with aria-describedby, so a
// screen reader reads it each time the control takes focus, not only once when
// an error appears.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, type ReactElement } from "react";
import { test } from "tap";
import { CheckboxField, RadioGroup, SelectField, TextField } from "../../../src/components/ui/fields/field.js";

const noop = (): void => undefined;

/** The described-by target of the element matching `selector`, and that target's text. */
async function description(element: ReactElement, selector: string): Promise<{ describedBy: string | null; text: string | null }> {
  const view = await mount(element);
  const control = view.container.querySelector(selector);
  const describedBy = control?.getAttribute("aria-describedby") ?? null;
  const text = describedBy === null ? null : (view.container.querySelector(`#${describedBy}`)?.textContent ?? null);
  await view.unmount();
  return { describedBy, text };
}

void test("a text field's helper describes the input", async (t) => {
  const result = await description(h(TextField, { id: "bbx-t-name", label: "Name", value: "", onChange: noop, helper: "As on your card" }), "input");
  t.check(result, { describedBy: "bbx-t-name-message", text: "As on your card" });
});

void test("an error replaces the helper as the description", async (t) => {
  const result = await description(
    h(TextField, { id: "bbx-t-email", label: "Email", value: "x", onChange: noop, helper: "Work email", error: "Not an email address" }),
    "input",
  );
  t.check(result, { describedBy: "bbx-t-email-message", text: "Not an email address" });
});

void test("a field with no message has no aria-describedby", async (t) => {
  const result = await description(h(TextField, { id: "bbx-t-plain", label: "Plain", value: "", onChange: noop }), "input");
  t.check(result, { describedBy: null, text: null });
});

void test("select, checkbox, and radio group are described the same way", async (t) => {
  const select = await description(
    h(SelectField, { id: "bbx-t-zone", label: "Zone", value: "a", onChange: noop, options: [{ value: "a", label: "A" }], helper: "Your time zone" }),
    "select",
  );
  const checkbox = await description(h(CheckboxField, { id: "bbx-t-ok", label: "OK", checked: false, onChange: noop, error: "Required" }), "input");
  const radio = await description(
    h(RadioGroup, { id: "bbx-t-size", label: "Size", value: "s", onChange: noop, options: [{ value: "s", label: "Small" }], helper: "Pick one" }),
    "[role=radiogroup]",
  );
  t.check({ select, checkbox, radio }, {
    select: { describedBy: "bbx-t-zone-message", text: "Your time zone" },
    checkbox: { describedBy: "bbx-t-ok-message", text: "Required" },
    radio: { describedBy: "bbx-t-size-message", text: "Pick one" },
  });
});
