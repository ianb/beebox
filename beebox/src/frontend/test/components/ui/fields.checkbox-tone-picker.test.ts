// The field primitives that replaced raw controls: a bare Checkbox named by
// its own label or by the text beside it, SelectField's dark tone for the
// capture screen, and useFilePicker's hidden file input.
// First, and bare: React DOM must load after the happy-dom window exists.
import { accessibleName, byId, byRole, mount } from "../../helpers/dom-harness.js";
import { createElement as h, Fragment } from "react";
import { test } from "tap";
import { Checkbox, SelectField, useFilePicker } from "../../../src/components/ui/fields/field.js";

const noop = (): void => undefined;

void test("a checkbox is named by aria-label or by the text it is labelled by", async (t) => {
  const view = await mount(h(Fragment, null,
    h(Checkbox, { id: "bbx-t-own", checked: false, onChange: noop, "aria-label": "Mark “Buy seeds” done" }),
    h(Checkbox, { id: "bbx-t-row", checked: true, onChange: noop, "aria-labelledby": "bbx-t-row-text" }),
    h("span", { id: "bbx-t-row-text" }, "Water the tray"),
  ));
  const own = byId(view.container, "bbx-t-own");
  const row = byId(view.container, "bbx-t-row");
  t.check({ own: accessibleName(own), row: accessibleName(row) }, { own: "Mark “Buy seeds” done", row: "Water the tray" });
  await view.unmount();
});

void test("a checkbox reports the new checked state", async (t) => {
  const seen: boolean[] = [];
  const view = await mount(h(Checkbox, { checked: false, onChange: (checked) => { seen.push(checked); }, "aria-label": "Done" }));
  await view.act(() => { byRole(view.container, { role: "checkbox", name: "Done" }).click(); });
  t.check(seen, [true]);
  await view.unmount();
});

void test("a checkbox without onChange is a read-only marker", async (t) => {
  const view = await mount(h(Checkbox, { checked: true, disabled: true, "aria-label": "Task", className: "mr-2" }));
  const box = byRole(view.container, { role: "checkbox", name: "Task" });
  t.check(
    { readOnly: box.hasAttribute("readonly"), disabled: box.hasAttribute("disabled"), classes: [...box.classList] },
    { readOnly: true, disabled: true, classes: ["accent-primary", "disabled:cursor-not-allowed", "mr-2"] },
  );
  await view.unmount();
});

/** The select's classes and its label's classes, for one tone. */
async function selectTone(tone: "light" | "dark" | undefined): Promise<{ select: string[]; label: string[] }> {
  const view = await mount(h(SelectField, { id: "bbx-t-camera", label: "Camera", value: "", onChange: noop, options: [{ value: "", label: "Default" }], tone }));
  const select = byRole(view.container, { role: "combobox", name: "Camera" });
  const label = view.container.querySelector("label[for=bbx-t-camera]");
  const result = { select: [...select.classList], label: [...(label?.classList ?? [])] };
  await view.unmount();
  return result;
}

void test("a dark select uses the dark dialog's field and ink; light is the default", async (t) => {
  const base = ["w-full", "border", "rounded", "px-3", "py-2", "focus:outline-none", "focus:ring-2", "focus:ring-accent", "disabled:opacity-50", "disabled:cursor-not-allowed"];
  const light = {
    select: [...base, "bg-white", "text-warm-900", "[color-scheme:light]", "focus:border-warm-900", "border-warm-700"],
    label: ["block", "text-sm", "font-medium", "text-warm-700", "mb-1"],
  };
  t.check(await selectTone(undefined), light);
  t.check(await selectTone("light"), light);
  t.check(await selectTone("dark"), {
    select: [...base, "bg-gray-900", "text-white", "[color-scheme:dark]", "focus:border-white", "border-gray-400"],
    label: ["block", "text-sm", "font-medium", "text-gray-300", "mb-1"],
  });
});

function Picker({ onFiles }: { onFiles: (files: File[]) => void }) {
  const picker = useFilePicker({ accept: "image/*", multiple: true, onFiles });
  return h(Fragment, null, h("button", { type: "button", id: "bbx-t-pick", onClick: picker.open }, "Add photos"), picker.input);
}

/** Set an input's file list, as the browser does after a pick, and fire its change event. */
function pick(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

void test("useFilePicker renders one hidden file input that the caller's button opens", async (t) => {
  const view = await mount(h(Picker, { onFiles: noop }));
  const input = view.container.querySelector("input");
  if (input === null) throw new Error("no file input");
  let opened = 0;
  input.addEventListener("click", () => { opened += 1; });
  await view.act(() => { byId(view.container, "bbx-t-pick").click(); });
  t.check(
    { type: input.type, accept: input.accept, multiple: input.multiple, hidden: input.hidden, inputs: view.container.querySelectorAll("input").length, opened },
    { type: "file", accept: "image/*", multiple: true, hidden: true, inputs: 1, opened: 1 },
  );
  await view.unmount();
});

void test("useFilePicker reports picked files and skips a cancelled pick", async (t) => {
  const picks: string[][] = [];
  const view = await mount(h(Picker, { onFiles: (files) => { picks.push(files.map((file) => file.name)); } }));
  const input = view.container.querySelector("input");
  if (input === null) throw new Error("no file input");
  await view.act(() => { pick(input, [new File(["a"], "tray.jpg"), new File(["b"], "seeds.jpg")]); });
  await view.act(() => { pick(input, []); });
  t.check(picks, [["tray.jpg", "seeds.jpg"]]);
  await view.unmount();
});
